/**
 * Criação manual de lead (POST /api/v1/leads → createLeadHandler) quando o
 * contato JÁ tem um lead aberto na organização.
 *
 * A trava `uniq_crm_leads_org_contact_aberto` (migration 0169) barra o INSERT
 * com 23505. O caminho automático (garantirLeadDaConversa,
 * lib/leads/nascimento-do-lead.ts) já trata isso como "já existe" — este
 * teste prova que a criação MANUAL agora devolve um erro de negócio claro
 * (409 lead_already_open_for_contact) em vez de internal_error genérico.
 */
import { describe, expect, it, vi } from "vitest";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { ApiError } from "@/lib/api/types";
import type { CreateLeadInput } from "@/lib/schemas";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PIPELINE_ID = "33333333-3333-4333-8333-333333333333";
const STAGE_ID = "44444444-4444-4444-8444-444444444444";
const CONTACT_ID = "55555555-5555-4555-8555-555555555555";

function makeSupabaseStub(insertError: { code: string; message: string } | null) {
  return {
    from(table: string) {
      const b = {
        _op: "select" as "select" | "insert",
        select() {
          return b;
        },
        insert() {
          b._op = "insert";
          return b;
        },
        eq() {
          return b;
        },
        order() {
          return b;
        },
        limit() {
          return b;
        },
        maybeSingle() {
          if (table === "crm_stages") {
            return Promise.resolve({
              data: { id: STAGE_ID, pipeline_id: PIPELINE_ID, organization_id: ORG_ID },
              error: null,
            });
          }
          // crm_leads select (posição máxima) — nenhum lead ainda na etapa.
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          if (insertError) {
            return Promise.resolve({ data: null, error: insertError });
          }
          return Promise.resolve({
            data: { id: "lead-1", pipeline_id: PIPELINE_ID, stage_id: STAGE_ID, title: "Teste" },
            error: null,
          });
        },
      };
      return b;
    },
    rpc() {
      return { then: (onF: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(onF) };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseInput(): CreateLeadInput {
  return {
    pipeline_id: PIPELINE_ID,
    stage_id: STAGE_ID,
    title: "Pedido novo",
    contact_id: CONTACT_ID,
    currency: "BRL",
    tags: [],
    source: "manual",
  };
}

const ctx = { organization_id: ORG_ID, actor: { type: "user" as const, id: "user-1" }, requestId: "req-1" };

describe("createLeadHandler — contato já tem lead aberto", () => {
  it("23505 (uniq_crm_leads_org_contact_aberto) → 409 lead_already_open_for_contact, não internal_error", async () => {
    const supabase = makeSupabaseStub({
      code: "23505",
      message: 'duplicate key value violates unique constraint "uniq_crm_leads_org_contact_aberto"',
    });
    await expect(createLeadHandler(supabase, ctx, baseInput())).rejects.toMatchObject({
      status: 409,
      code: "lead_already_open_for_contact",
    } satisfies Partial<ApiError>);
  });

  it("outro erro de INSERT continua caindo em internal_error (não engole erro de verdade)", async () => {
    const supabase = makeSupabaseStub({ code: "23502", message: "null value in column violates not-null" });
    await expect(createLeadHandler(supabase, ctx, baseInput())).rejects.toMatchObject({
      status: 500,
      code: "internal_error",
    } satisfies Partial<ApiError>);
  });

  it("sem conflito → cria normalmente", async () => {
    const supabase = makeSupabaseStub(null);
    const lead = await createLeadHandler(supabase, ctx, baseInput());
    expect(lead).toMatchObject({ id: "lead-1" });
  });
});
