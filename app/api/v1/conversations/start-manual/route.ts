/**
 * POST /api/v1/conversations/start-manual
 *
 * A tela "Nova conversa": a pessoa escolhe um contato (ou informa nome+
 * telefone de um novo) e escreve a primeira mensagem. Três passos, um
 * request só — sem estado parcial visível pro cliente numa falha no meio:
 *
 *   1. `openSharedContactConversation` — acha/cria contato + conversa
 *      (mesma função de `open-with-contact`, sem modificação nenhuma).
 *   2. `pausarAtendimentoAutomatico` — a conversa nasce com `force_human=true`:
 *      quem começou foi um humano, e o agente não deve responder, mesmo que
 *      o contato responda depois. Ver o cabeçalho de lib/escalacao/pausar.ts.
 *   3. `sendMessageHandler` — envia a mensagem via WAHA, o mesmo caminho que
 *      qualquer outra mensagem outbound do inbox usa.
 *
 * A ordem importa: pausar ANTES de enviar, não depois — se o passo 3 falhar
 * (WAHA fora do ar, por exemplo), a conversa já criada não fica um instante
 * sequer elegível para o agente responder.
 *
 * Auth: cookie session, role >= agent (mesmo mínimo de /messages e
 * /open-with-contact — enviar mensagem é escrita, viewer é read-only).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { pausarAtendimentoAutomatico } from "@/lib/escalacao/pausar";
import { openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";
import { startManualConversationSchema, validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(startManualConversationSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const admin = createAdminClient();

  let opened;
  try {
    opened = await openSharedContactConversation(admin, activeOrg.orgId, {
      channel_session_id: input.channel_session_id,
      contact_id: input.contact_id,
      phone_number: input.phone_number,
      name: input.name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "open_failed";
    if (msg === "contact_not_found") {
      return fail("not_found", "Contato não encontrado.", 404, { requestId });
    }
    if (msg === "session_not_found") {
      return fail("not_found", "Sessão de canal não encontrada.", 404, { requestId });
    }
    if (msg === "invalid_phone") {
      return fail("validation_error", "Telefone inválido.", 422, { requestId });
    }
    return fail("internal_error", msg, 500, { requestId });
  }

  const pausado = await pausarAtendimentoAutomatico(
    {
      supabase: admin,
      organizationId: activeOrg.orgId,
      actor: { type: "user", id: authUser.id, role: activeOrg.role },
      requestId,
    },
    {
      conversationId: opened.conversation_id,
      reason: "Conversa iniciada manualmente pelo atendente",
    },
  );
  if (!pausado.ok) {
    return fail(
      "internal_error",
      "Conversa criada, mas não consegui travar o atendimento automático — pause manualmente antes de continuar.",
      500,
      { requestId },
    );
  }

  const supabase = await createClient();
  try {
    const message = await sendMessageHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: authUser.id },
        requestId,
      },
      { conversation_id: opened.conversation_id, type: "text", body: input.body },
    );
    return ok(
      { conversation_id: opened.conversation_id, contact_id: opened.contact_id, message },
      { status: 201, requestId },
    );
  } catch (err) {
    if (err instanceof ApiError) {
      // Conversa e trava já existem — só a mensagem falhou. Quem chamou pode
      // abrir a conversa (já travada, já sem a IA) e tentar mandar de novo.
      return fail(err.code, err.message, err.status, {
        requestId,
        details: { conversation_id: opened.conversation_id },
      });
    }
    throw err;
  }
}
