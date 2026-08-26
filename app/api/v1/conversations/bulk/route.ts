/**
 * POST /api/v1/conversations/bulk
 *
 * Bulk operations on conversations (set_status/tag/mark_read). Discriminated
 * by `action`, mesmo molde de app/api/v1/leads/bulk/route.ts. Máx. 50 ids por
 * chamada. RLS escopa tudo ao tenant do chamador.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { bulkConversationActionSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BULK = 50;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  // Mesmo piso do PATCH singular (app/api/v1/conversations/[id]/route.ts):
  // escrita é agent+, viewer é read-only. Nenhuma ação deste bulk equivale a
  // reatribuir dono (isso é a transferência, `/conversations/[id]/transfer`,
  // fora do escopo deste endpoint), então não precisa de piso mais alto.
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  let input;
  try {
    input = await validateRequest(bulkConversationActionSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  if (input.conversation_ids.length > MAX_BULK) {
    return fail("bulk_too_large", `Máximo ${MAX_BULK} conversas por bulk.`, 422, { requestId });
  }

  // Org de fonte confiável = org ativa do cookie (authz), nunca inferida das
  // linhas — mesmo racional do bulk de leads (INB-09 nota 2).
  const organizationId = authz.org.orgId;
  const { data: scoped } = await supabase
    .from("conversations")
    .select("id, organization_id, tags")
    .eq("organization_id", organizationId)
    .in("id", input.conversation_ids);

  const visible = scoped ?? [];
  const first = visible[0];
  if (!first) {
    return fail("not_found", "Nenhuma conversa acessível na operação.", 404, { requestId });
  }
  const visibleIds = visible.map((r) => r.id as string);

  let updatedCount = 0;
  const nowIso = new Date().toISOString();

  switch (input.action) {
    case "set_status": {
      const { data, error } = await supabase
        .from("conversations")
        .update({ status: input.params.status, status_changed_at: nowIso })
        .in("id", visibleIds)
        .select("id");
      if (error) return fail("internal_error", error.message, 500, { requestId });
      updatedCount = data?.length ?? 0;
      break;
    }
    case "tag": {
      const add = input.params.add;
      // Cada conversa tem tags atuais diferentes — soma por linha, mesmo
      // padrão do case "tag" de leads/bulk (não é um replace, é união).
      for (const row of visible) {
        const current = (row.tags ?? []) as string[];
        const next = Array.from(new Set([...current, ...add]));
        const { error } = await supabase
          .from("conversations")
          .update({ tags: next })
          .eq("id", row.id);
        if (error) return fail("internal_error", error.message, 500, { requestId });
        updatedCount += 1;
      }
      break;
    }
    case "mark_read": {
      const { data, error } = await supabase
        .from("conversations")
        .update({ unread_count_for_assignee: 0 })
        .in("id", visibleIds)
        .select("id");
      if (error) return fail("internal_error", error.message, 500, { requestId });
      updatedCount = data?.length ?? 0;
      break;
    }
  }

  // Uma única entrada de audit por chamada, com a contagem — mesmo padrão de
  // leads/bulk. mark_read fica de fora: o PATCH singular equivalente
  // (markConversationReadHandler) também não audita, é estado de leitura, não
  // mutação de negócio.
  if (input.action !== "mark_read") {
    await audit({
      action: input.action === "set_status" ? "conversation.bulk_status_changed" : "conversation.bulk_tagged",
      actorUserId: user.id,
      organizationId,
      resourceType: "conversation",
      resourceId: null,
      requestId,
      metadata: {
        action: input.action,
        conversation_ids: visibleIds,
        count: updatedCount,
        updated_count: updatedCount,
        params: input.params,
      },
    });
  }

  return ok({ updated_count: updatedCount, conversation_ids: visibleIds }, { requestId });
}
