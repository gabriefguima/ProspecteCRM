/**
 * A busca do Inbox (?search=) só filtrava por `last_message_preview` — quem
 * procurasse pelo NOME do contato (o caso mais comum: "cadê a conversa da
 * Renata?") nunca achava nada, a menos que a palavra aparecesse literalmente
 * no texto da última mensagem. Medido em produção: busca por "Renata Dourado"
 * não encontrava a conversa dela.
 *
 * ## Duas tentativas, a primeira quebrou em produção
 *
 * A primeira versão deste fix tentou um único `.or()` combinando
 * `last_message_preview.ilike...` (coluna de `conversations`) com
 * `contacts.display_name.ilike...` (coluna da tabela embutida) — e o
 * PostgREST recusa com `PGRST100 failed to parse logic tree`: ele não aceita
 * misturar coluna da própria tabela com coluna de tabela embutida dentro do
 * mesmo `or()`. Confirmado direto contra a API REST de produção antes de
 * corrigir (não é suposição).
 *
 * A versão certa faz DUAS queries: primeiro resolve quais `contacts.id`
 * batem por nome/telefone (um `.or()` só com colunas de `contacts`, válido),
 * depois usa esses ids num `contact_id.in.(...)` — coluna da PRÓPRIA tabela
 * `conversations` — combinado com `last_message_preview.ilike...` no `or()`
 * principal. As duas pernas do `or` final são sempre colunas de
 * `conversations`.
 */
import { describe, expect, it } from "vitest";

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";

interface Chamada {
  metodo: string;
  args: unknown[];
}

const CONTACT_ID = "786fa70c-e868-4df6-87db-2da6c0c91216";

/** Um builder chainable que registra toda chamada e resolve num valor fixo. */
function makeBuilder(chamadas: Chamada[], resultado: { data: unknown; error: unknown }) {
  const builder: Record<string, (...args: unknown[]) => unknown> & PromiseLike<unknown> = {
    then(onF: (v: unknown) => unknown) {
      return Promise.resolve(resultado).then(onF);
    },
  } as never;
  for (const metodo of ["select", "eq", "order", "limit", "not", "contains", "is", "or", "gt", "lt"]) {
    builder[metodo] = (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return builder;
    };
  }
  return builder;
}

/** `contatosEncontrados`: o que a query prévia em `contacts` devolve. */
function makeSupabaseStub(contatosEncontrados: Array<{ id: string }>) {
  const chamadasContacts: Chamada[] = [];
  const chamadasConversations: Chamada[] = [];
  const supabase = {
    from(table: string) {
      if (table === "contacts") {
        return makeBuilder(chamadasContacts, { data: contatosEncontrados, error: null });
      }
      return makeBuilder(chamadasConversations, { data: [], error: null });
    },
  } as never;
  return { supabase, chamadasContacts, chamadasConversations };
}

const ctx = { organization_id: "org-1", actor: { type: "user" as const, id: "u-1" }, requestId: "req-1" };

describe("listConversationsHandler — busca por nome/telefone do contato", () => {
  it("com search, faz uma query prévia em `contacts` com or() de display_name/name/phone_number", async () => {
    const { supabase, chamadasContacts } = makeSupabaseStub([]);
    await listConversationsHandler(supabase, ctx, { search: "Renata", limit: 25 } as never);
    const or = chamadasContacts.find((c) => c.metodo === "or");
    expect(or?.args[0]).toBe(
      "display_name.ilike.%Renata%,name.ilike.%Renata%,phone_number.ilike.%Renata%",
    );
  });

  it("sem search, NÃO consulta `contacts` separadamente", async () => {
    const { supabase, chamadasContacts } = makeSupabaseStub([]);
    await listConversationsHandler(supabase, ctx, { limit: 25 } as never);
    expect(chamadasContacts.length).toBe(0);
  });

  it("o select da query principal nunca usa !inner (a leitura normal de grupo/sem-contato não pode sumir)", async () => {
    const { supabase, chamadasConversations } = makeSupabaseStub([{ id: CONTACT_ID }]);
    await listConversationsHandler(supabase, ctx, { search: "Renata", limit: 25 } as never);
    const select = chamadasConversations.find((c) => c.metodo === "select");
    expect(select?.args[0]).not.toContain("!inner");
  });

  it("com contato encontrado, o or() principal combina last_message_preview E contact_id.in — as DUAS pernas são colunas de `conversations`", async () => {
    const { supabase, chamadasConversations } = makeSupabaseStub([{ id: CONTACT_ID }]);
    await listConversationsHandler(supabase, ctx, { search: "Renata", limit: 25 } as never);
    const or = chamadasConversations.find((c) => c.metodo === "or");
    expect(or?.args[0]).toBe(`last_message_preview.ilike.%Renata%,contact_id.in.(${CONTACT_ID})`);
  });

  it("sem contato encontrado, o or() principal só tem a perna de last_message_preview (sem .in() vazio)", async () => {
    const { supabase, chamadasConversations } = makeSupabaseStub([]);
    await listConversationsHandler(supabase, ctx, { search: "Renata", limit: 25 } as never);
    const or = chamadasConversations.find((c) => c.metodo === "or");
    expect(or?.args[0]).toBe("last_message_preview.ilike.%Renata%");
  });

  it("sem search, nenhum .or() de busca é chamado na query principal", async () => {
    const { supabase, chamadasConversations } = makeSupabaseStub([]);
    await listConversationsHandler(supabase, ctx, { limit: 25 } as never);
    expect(chamadasConversations.some((c) => c.metodo === "or")).toBe(false);
  });
});
