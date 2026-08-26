/**
 * POST /api/v1/contacts/bulk
 *
 * Bulk operations on contacts. Só `tag` no MVP — mesmo molde de
 * app/api/v1/leads/bulk/route.ts. Máx. 50 ids por chamada. RLS escopa tudo
 * ao tenant do chamador.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { bulkContactActionSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BULK = 50;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  // Mesmo piso do PATCH singular (app/api/v1/contacts/[id]/route.ts): escrita
  // é agent+, viewer é read-only.
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  let input;
  try {
    input = await validateRequest(bulkContactActionSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  if (input.contact_ids.length > MAX_BULK) {
    return fail("bulk_too_large", `Máximo ${MAX_BULK} contatos por bulk.`, 422, { requestId });
  }

  const organizationId = authz.org.orgId;
  const { data: scoped } = await supabase
    .from("contacts")
    .select("id, organization_id, tags")
    .eq("organization_id", organizationId)
    .in("id", input.contact_ids);

  const visible = scoped ?? [];
  const first = visible[0];
  if (!first) {
    return fail("not_found", "Nenhum contato acessível na operação.", 404, { requestId });
  }
  const visibleIds = visible.map((r) => r.id as string);

  let updatedCount = 0;
  const add = input.params.add;

  // Cada contato tem tags atuais diferentes — soma por linha (união), não
  // substitui. Mesmo padrão do case "tag" de leads/bulk e de conversations/bulk.
  for (const row of visible) {
    const current = (row.tags ?? []) as string[];
    const next = Array.from(new Set([...current, ...add]));
    const { error } = await supabase.from("contacts").update({ tags: next }).eq("id", row.id);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    updatedCount += 1;
  }

  await audit({
    action: "contact.bulk_tagged",
    actorUserId: user.id,
    organizationId,
    resourceType: "contact",
    resourceId: null,
    requestId,
    metadata: {
      action: input.action,
      contact_ids: visibleIds,
      count: updatedCount,
      updated_count: updatedCount,
      params: input.params,
    },
  });

  return ok({ updated_count: updatedCount, contact_ids: visibleIds }, { requestId });
}
