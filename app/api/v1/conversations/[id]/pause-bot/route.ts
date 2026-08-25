/**
 * POST /api/v1/conversations/[id]/pause-bot
 *
 * Pausa o atendimento automático manualmente — o oposto de `reactivate-bot`.
 * A REGRA vive em `lib/escalacao/pausar.ts`; esta rota só resolve
 * autenticação, org e a tradução do resultado para HTTP. Mesmo desenho da
 * irmã: a regra mora numa função porque a criação de conversa pela tela
 * "Nova conversa" (item 2) precisa da MESMA garantia, não de uma cópia.
 *
 * Auth: cookie session, role >= agent. Audit: `human.paused_agent`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { pausarAtendimentoAutomatico } from "@/lib/escalacao/pausar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const supabase = await createClient();

  const resultado = await pausarAtendimentoAutomatico(
    {
      supabase,
      organizationId: activeOrg.orgId,
      actor: { type: "user", id: authUser.id, role: activeOrg.role },
      requestId,
    },
    { conversationId: id },
  );

  if (!resultado.ok) {
    if (resultado.erro === "conversation_not_found") {
      return fail("not_found", "Conversa não encontrada.", 404, { requestId });
    }
    if (resultado.erro === "emit_signal_failed") {
      // O bloqueio (force_human) já foi gravado antes deste passo — a IA já
      // não responde. O que falhou foi só o sinal que pausa um follow-up vivo
      // do contato; repetir é seguro (idempotente).
      return fail(
        "internal_error",
        "Atendimento pausado, mas o sinal que pausa o acompanhamento automático falhou — tente de novo.",
        500,
        { requestId },
      );
    }
    return fail(
      "internal_error",
      "Não consegui pausar o atendimento automático — tente de novo.",
      500,
      { requestId },
    );
  }

  return ok({ paused: true, already_paused: resultado.jaEstavaPausada }, { requestId });
}
