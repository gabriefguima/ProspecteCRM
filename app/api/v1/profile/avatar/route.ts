/**
 * POST/DELETE /api/v1/profile/avatar — o avatar de perfil, subido do
 * computador (recortado no navegador antes de chegar aqui).
 *
 * Mesma disciplina de segurança de `app/api/v1/marca/logo/route.ts` (farejar
 * bytes, recusar SVG, caminho não-enumerável, sobe→grava→apaga), com um gate
 * BEM mais simples: aqui não há escopo nem papel pra escolher — é sempre o
 * PRÓPRIO usuário logado mexendo no PRÓPRIO avatar. Sem MFA extra pelo mesmo
 * motivo que a tela de Perfil não exige: trocar a própria foto não é uma
 * capacidade de risco crítico como trocar o logo que todo cliente vê no login.
 *
 * A gravação final é a MESMA chamada que `updateProfile.ts` já faz
 * (`supabase.auth.updateUser({data:{avatar_url}})`) — não duplico o caminho de
 * persistência do perfil; esta rota só cuida do Storage e devolve a URL.
 */
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import {
  BUCKET_DE_AVATARES,
  TAMANHO_MAXIMO_DO_AVATAR,
  caminhoNovoDoAvatar,
  extensaoDe,
  farejarTipo,
  pareceSvg,
  podeApagarAvatar,
  prefixoDoUsuario,
  urlPublicaDoAvatar,
} from "@/lib/profile/avatar";
import { baseDoStorage } from "@/lib/branding/logo";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TETO_POR_USUARIO = 10;
const JANELA_SEGUNDOS = 300;

/** O caminho HOJE, lido do `user_metadata` — nunca do cliente. */
function caminhoGravado(user: { user_metadata?: Record<string, unknown> | null }): string | null {
  const v = user.user_metadata?.avatar_path;
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Faça login.", 401, { requestId });

  const limite = await checkRateLimit(`profile-avatar:${user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", "Muitas trocas de foto seguidas. Tente em alguns minutos.", 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Campo 'file' (multipart) obrigatório.", 422, { requestId });
  }
  if (file.size > TAMANHO_MAXIMO_DO_AVATAR) {
    return fail(
      "payload_too_large",
      "A foto precisa ter até 512 KB depois de recortada. Tente um zoom um pouco maior.",
      413,
      { requestId },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (pareceSvg(bytes)) {
    return fail(
      "avatar_svg_recusado",
      "SVG não é aceito como foto de perfil. Exporte como PNG ou JPG.",
      415,
      { requestId },
    );
  }

  const tipo = farejarTipo(bytes);
  if (!tipo) {
    return fail("unsupported_media_type", "A foto precisa ser PNG ou JPG.", 415, {
      requestId,
      details: { content_type_declarado: file.type || null },
    });
  }

  // `getUser()` de novo (não o `AuthUser` já carregado): é ele que traz o
  // `user_metadata` cru, e `loadAuthUser()` não o repassa (não é seu contrato).
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const anterior = authUser ? caminhoGravado(authUser) : null;

  const caminho = caminhoNovoDoAvatar(user.id, extensaoDe(tipo));

  const admin = createAdminClient();
  const { error: erroUp } = await admin.storage
    .from(BUCKET_DE_AVATARES)
    .upload(caminho, bytes, { contentType: tipo, upsert: false });
  if (erroUp) {
    logger.error("[profile/avatar] upload falhou", { detalhe: erroUp.message, requestId });
    return fail("internal_error", "Erro ao subir a foto.", 500, { requestId });
  }

  const avatarUrl = urlPublicaDoAvatar(caminho, baseDoStorage());
  const { error: erroSalvar } = await supabase.auth.updateUser({
    data: { avatar_url: avatarUrl, avatar_path: caminho },
  });
  if (erroSalvar) {
    // Gravação falhou DEPOIS do upload: o arquivo NOVO é que vira órfão.
    void admin.storage.from(BUCKET_DE_AVATARES).remove([caminho]);
    logger.error("[profile/avatar] gravação falhou", { detalhe: erroSalvar.message, requestId });
    return fail("internal_error", "Erro ao salvar a foto no perfil.", 500, { requestId });
  }

  if (anterior && podeApagarAvatar(anterior, user.id)) {
    const { error: erroDel } = await admin.storage.from(BUCKET_DE_AVATARES).remove([anterior]);
    if (erroDel) {
      logger.warn("[profile/avatar] foto anterior ficou órfã", {
        detalhe: erroDel.message,
        caminho: anterior,
      });
    }
  } else if (anterior) {
    logger.error("[profile/avatar] recusei apagar arquivo fora do prefixo do usuário", {
      prefixo_esperado: prefixoDoUsuario(user.id),
      caminho_recusado: anterior,
    });
  }

  void audit({
    action: "profile.updated",
    actorUserId: user.id,
    resourceType: "user",
    resourceId: user.id,
    requestId,
    metadata: { fields_changed: ["avatar_url"] },
  });

  return ok({ avatar_url: avatarUrl }, { requestId, status: 201 });
}

/** Remove a foto de perfil — o usuário volta ao estado sem avatar. */
export async function DELETE(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Faça login.", 401, { requestId });

  const limite = await checkRateLimit(`profile-avatar:${user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", "Muitas trocas de foto seguidas. Tente em alguns minutos.", 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const anterior = authUser ? caminhoGravado(authUser) : null;

  const { error } = await supabase.auth.updateUser({
    data: { avatar_url: null, avatar_path: null },
  });
  if (error) {
    logger.error("[profile/avatar] remoção falhou", { detalhe: error.message, requestId });
    return fail("internal_error", "Erro ao remover a foto.", 500, { requestId });
  }

  if (anterior && podeApagarAvatar(anterior, user.id)) {
    void createAdminClient().storage.from(BUCKET_DE_AVATARES).remove([anterior]);
  }

  void audit({
    action: "profile.updated",
    actorUserId: user.id,
    resourceType: "user",
    resourceId: user.id,
    requestId,
    metadata: { fields_changed: ["avatar_url"], avatar_removido: true },
  });

  return ok({ avatar_url: null }, { requestId });
}
