/**
 * Bulk de contatos (seleção múltipla na tela de Contatos) — POST /api/v1/contacts/bulk.
 *
 * Só a ação `tag` no MVP. Prova, contra o Route Handler REAL (auth e Supabase
 * mockados):
 *  - gate agent+ (viewer é read-only, mesmo piso do PATCH singular);
 *  - tag: soma por linha (união com as tags atuais, não substitui), audit
 *    agregado `contact.bulk_tagged` com count;
 *  - limite: acima do teto (MAX_BULK=50) → 422, sem UPDATE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/api/wrappers";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_A = "44444444-4444-4444-8444-444444444444";
const CONTACT_B = "55555555-5555-4555-8555-555555555555";

interface StubState {
  scopedRows: Array<Record<string, unknown>>;
  updateCalled: boolean;
}

function stubState(overrides: Partial<StubState> = {}): StubState {
  return {
    scopedRows: [
      { id: CONTACT_A, organization_id: ORG_ID, tags: ["vip"] },
      { id: CONTACT_B, organization_id: ORG_ID, tags: [] },
    ],
    updateCalled: false,
    ...overrides,
  };
}

function makeSupabaseStub(state: StubState) {
  return {
    from: () => {
      const b = {
        _op: "select" as "select" | "update",
        select() {
          return b;
        },
        update() {
          b._op = "update";
          state.updateCalled = true;
          return b;
        },
        in() {
          return b;
        },
        eq() {
          return b;
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          const result =
            b._op === "select" ? { data: state.scopedRows, error: null } : { data: null, error: null };
          return Promise.resolve(result).then(onF, onR);
        },
      };
      return b;
    },
  };
}

function session(effectiveRole: Role, state: StubState) {
  const user: AuthUser = {
    id: USER_ID,
    email: "u@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: effectiveRole }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) => {
    if (ROLE_RANK[effectiveRole] >= ROLE_RANK[min]) {
      return { ok: true, user, org: { orgId: ORG_ID, name: "Org", role: effectiveRole } };
    }
    return {
      ok: false,
      response: fail("forbidden_role", `Requer role >= ${min}.`, 403, {}),
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(makeSupabaseStub(state) as any);
}

function postReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/contacts/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/contacts/bulk — gate agent+", () => {
  it("viewer → 403 forbidden_role, sem UPDATE", async () => {
    const state = stubState();
    session("viewer", state);
    const { POST } = await import("@/app/api/v1/contacts/bulk/route");
    const res = await POST(
      postReq({ action: "tag", contact_ids: [CONTACT_A, CONTACT_B], params: { add: ["novo"] } }),
    );
    expect(res.status).toBe(403);
    expect(state.updateCalled).toBe(false);
  });
});

describe("POST /api/v1/contacts/bulk — tag", () => {
  it("agent → 200, soma a tag nova às já existentes de cada linha, audit agregado com count", async () => {
    const state = stubState();
    session("agent", state);
    const { POST } = await import("@/app/api/v1/contacts/bulk/route");
    const res = await POST(
      postReq({ action: "tag", contact_ids: [CONTACT_A, CONTACT_B], params: { add: ["novo"] } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { updated_count: number } };
    expect(body.data.updated_count).toBe(2);
    expect(state.updateCalled).toBe(true);
    const entry = vi
      .mocked(audit)
      .mock.calls.map(([e]) => e)
      .find((e) => e.action === "contact.bulk_tagged");
    expect(entry).toBeDefined();
    expect(entry?.metadata).toMatchObject({ count: 2 });
  });
});

describe("POST /api/v1/contacts/bulk — limite (MAX_BULK=50)", () => {
  it("acima do teto → 422, sem UPDATE", async () => {
    const state = stubState();
    session("agent", state);
    const tooMany = Array.from(
      { length: 51 },
      (_, i) => `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
    );
    const { POST } = await import("@/app/api/v1/contacts/bulk/route");
    const res = await POST(postReq({ action: "tag", contact_ids: tooMany, params: { add: ["x"] } }));
    expect(res.status).toBe(422);
    expect(state.updateCalled).toBe(false);
  });
});
