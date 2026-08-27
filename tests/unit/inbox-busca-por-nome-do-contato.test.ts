/**
 * A busca do Inbox (?search=) só filtrava por `last_message_preview` — quem
 * procurasse pelo NOME do contato (o caso mais comum: "cadê a conversa da
 * Renata?") nunca achava nada, a menos que a palavra aparecesse literalmente
 * no texto da última mensagem. Medido em produção: busca por "Renata Dourado"
 * não encontrava a conversa dela.
 *
 * Este teste prova a query que `listConversationsHandler` monta, não o
 * resultado (o resto é responsabilidade do Postgres/PostgREST):
 *  - com `search`, o embed de `contacts` vira `!inner` (senão o filtro por
 *    coluna embutida não restringe as linhas de fora, só o aninhado);
 *  - o `.or()` cobre last_message_preview E display_name/name/phone_number.
 */
import { describe, expect, it } from "vitest";

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";

interface Chamada {
  metodo: string;
  args: unknown[];
}

function makeQueryStub() {
  const chamadas: Chamada[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> & PromiseLike<unknown> = {
    then(onF: (v: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(onF);
    },
  } as never;
  for (const metodo of ["select", "eq", "order", "limit", "not", "contains", "is", "or", "gt", "lt"]) {
    builder[metodo] = (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return builder;
    };
  }
  return { chamadas, builder };
}

function makeSupabaseStub() {
  const q = makeQueryStub();
  return {
    supabase: { from: () => q.builder } as never,
    chamadas: q.chamadas,
  };
}

const ctx = { organization_id: "org-1", actor: { type: "user" as const, id: "u-1" }, requestId: "req-1" };

describe("listConversationsHandler — busca por nome/telefone do contato", () => {
  it("com search, o select usa contacts!inner (não o embed padrão)", async () => {
    const { supabase, chamadas } = makeSupabaseStub();
    await listConversationsHandler(supabase, ctx, { search: "Renata", limit: 25 } as never);
    const select = chamadas.find((c) => c.metodo === "select");
    expect(select?.args[0]).toContain("contacts:contact_id!inner");
  });

  it("sem search, o select usa o embed padrão (sem !inner)", async () => {
    const { supabase, chamadas } = makeSupabaseStub();
    await listConversationsHandler(supabase, ctx, { limit: 25 } as never);
    const select = chamadas.find((c) => c.metodo === "select");
    expect(select?.args[0]).not.toContain("!inner");
  });

  it("o .or() cobre last_message_preview, display_name, name e phone_number", async () => {
    const { supabase, chamadas } = makeSupabaseStub();
    await listConversationsHandler(supabase, ctx, { search: "Renata", limit: 25 } as never);
    const or = chamadas.find((c) => c.metodo === "or");
    const filtro = or?.args[0] as string;
    expect(filtro).toContain("last_message_preview.ilike.%Renata%");
    expect(filtro).toContain("contacts.display_name.ilike.%Renata%");
    expect(filtro).toContain("contacts.name.ilike.%Renata%");
    expect(filtro).toContain("contacts.phone_number.ilike.%Renata%");
  });

  it("sem search, nenhum .or() de busca é chamado", async () => {
    const { supabase, chamadas } = makeSupabaseStub();
    await listConversationsHandler(supabase, ctx, { limit: 25 } as never);
    expect(chamadas.some((c) => c.metodo === "or")).toBe(false);
  });
});
