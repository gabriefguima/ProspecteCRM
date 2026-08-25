/**
 * Pausar o atendimento automático manualmente — o espelho de `retomada.ts`.
 *
 * ## Por que existe
 *
 * Até aqui, `contacts.force_human=true` só era escrito por UM caminho:
 * `performHumanHandoff` (lib/agent-engine/agent/human-handoff.ts), acionado
 * pela PRÓPRIA IA (regex determinística ou a tool `request_human_handoff`).
 * Não existia um caminho para a PESSOA pausar o agente por vontade própria,
 * numa conversa qualquer, sem esperar a IA decidir isso sozinha — nem para
 * marcar como "sempre humano" uma conversa que a pessoa mesma começou.
 *
 * ## Por que a função e não a rota
 *
 * Mesmo motivo de `retomada.ts`: duas entradas (o botão "Pausar automático"
 * no `ConversationHeader` e a criação de conversa pela tela "Nova conversa")
 * precisam da MESMA regra. Regra duplicada nos dois lados é o defeito que
 * `retomada.ts` documenta ter consertado — não repetir aqui.
 *
 * ## O que NÃO faz, de propósito
 *
 * Não mexe em `assignee_kind`/`assigned_to_user_id` — a constraint
 * `conversations_assignee_kind_coherence` exige um usuário quando
 * `assignee_kind='user'`, e "quem vai ficar dono" é uma decisão separada
 * (o botão "Assumir" já existe pra isso). Pausar o agente e reivindicar a
 * conversa são ações distintas; misturar as duas aqui obrigaria todo
 * chamador (inclusive a criação de conversa nova, que pode não ter um
 * usuário "dono" ainda) a resolver um problema que não é dele.
 *
 * Não cancela crons de follow-up pendentes (ao contrário de
 * `performHumanHandoff`): `before-send.ts` já veta TODO envio automático com
 * `(is_blocked or force_human) as stopped`, então um cron que dispare vira
 * no-op — a segunda trava (cron cancelado) é otimização de limpeza, não
 * segurança, e cancelar crons do motor exige `pg.Pool` do agent-engine, que
 * este código (Supabase client, roda no `app`) não tem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { logger } from "@/lib/logger";

/** Postgres `infinity`: mesmo valor que `performHumanHandoff` usa — o bot nunca reassume sozinho. */
const SILENCE_INFINITY = "infinity";

export interface PausarDeps {
  supabase: SupabaseClient;
  organizationId: string;
  actor: Actor;
  requestId: string;
  apiTokenId?: string | null;
}

export type PausarFalha = "conversation_not_found" | "update_failed";

export type PausarResultado =
  | {
      ok: true;
      conversationId: string;
      /** true = já estava pausada; a operação é idempotente. */
      jaEstavaPausada: boolean;
    }
  | { ok: false; erro: PausarFalha; detalhe?: string };

interface ConversaRow {
  id: string;
  contact_id: string | null;
  status: string | null;
}

export async function pausarAtendimentoAutomatico(
  deps: PausarDeps,
  input: { conversationId: string; reason?: string },
): Promise<PausarResultado> {
  const { supabase, organizationId } = deps;

  const { data: convData, error: convErr } = await supabase
    .from("conversations")
    .select("id, contact_id, status")
    .eq("id", input.conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (convErr) return { ok: false, erro: "conversation_not_found", detalhe: convErr.message };
  if (!convData) return { ok: false, erro: "conversation_not_found" };
  const conv = convData as unknown as ConversaRow;

  let jaEstavaPausada = false;
  if (conv.contact_id !== null) {
    const { data: contatoAtual } = await supabase
      .from("contacts")
      .select("force_human")
      .eq("id", conv.contact_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    jaEstavaPausada = (contatoAtual as { force_human?: boolean } | null)?.force_human === true;
  }

  const reason = input.reason?.trim() || "Pausado manualmente pelo atendente";

  // Mesmo CASE de `performHumanHandoff`: só 'ai_handling'→'pending'. Conversa já
  // claimed/pending/closed fica como está — pausar o agente nunca rouba nem reabre.
  const proximoStatus = conv.status === "ai_handling" ? "pending" : (conv.status ?? "open");
  const { error: updErr } = await supabase
    .from("conversations")
    .update({
      bot_silenced_until: SILENCE_INFINITY,
      last_handoff_at: new Date().toISOString(),
      last_handoff_reason: reason,
      // Zera aderência ao agente: se o bot for reativado depois, o router decide
      // de novo, não reassume o mesmo agente por inércia — mesma razão da 0085.
      active_ai_agent_id: null,
      active_intent: null,
      active_agent_set_at: null,
      status: proximoStatus,
      status_changed_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("organization_id", organizationId);
  if (updErr) return { ok: false, erro: "update_failed", detalhe: updErr.message };

  // A trava que os guards leem de verdade — sem isto as outras não servem de nada.
  if (conv.contact_id !== null) {
    const { error: contatoErr } = await supabase
      .from("contacts")
      .update({ force_human: true })
      .eq("id", conv.contact_id)
      .eq("organization_id", organizationId);
    if (contatoErr) {
      logger.error("[escalacao.pausar] force_human não foi gravado", {
        conversation_id: input.conversationId,
        error: contatoErr.message,
      });
      return { ok: false, erro: "update_failed", detalhe: contatoErr.message };
    }
  }

  if (conv.contact_id !== null && !jaEstavaPausada) {
    await emitirAtividadeDePausa(deps, conv.contact_id, input.conversationId, reason);
  }

  await audit({
    action: "human.paused_agent",
    actorUserId: deps.actor.type === "user" ? deps.actor.id : null,
    actorApiTokenId: deps.apiTokenId ?? null,
    organizationId,
    resourceType: "conversation",
    resourceId: input.conversationId,
    requestId: deps.requestId,
    metadata: { actor_type: deps.actor.type, reason },
  });

  return { ok: true, conversationId: input.conversationId, jaEstavaPausada };
}

/** A ida na linha do tempo do negócio — o par de `handoff_resolved` em `retomada.ts`. */
async function emitirAtividadeDePausa(
  deps: PausarDeps,
  contactId: string,
  conversationId: string,
  reason: string,
): Promise<void> {
  const { data: leadsData } = await deps.supabase
    .from("crm_leads")
    .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
    .eq("organization_id", deps.organizationId)
    .eq("contact_id", contactId);
  const { data: defaultPipeline } = await deps.supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", deps.organizationId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .limit(1)
    .maybeSingle();

  const alvo = resolveActiveLeadForContact((leadsData ?? []) as LeadCandidate[], {
    defaultPipelineId: (defaultPipeline as { id: string } | null)?.id ?? null,
  });
  if (!alvo.routed) return;

  const resultado = await emitLeadActivity(deps.supabase, {
    organizationId: deps.organizationId,
    leadId: alvo.leadId,
    contactId,
    type: "handoff_triggered",
    sourceModule: "escalacao.pausar",
    sourceId: conversationId,
    actor: deps.actor,
    reason,
    payload: { conversation_id: conversationId },
  });
  if (!resultado.ok) {
    logger.warn("[escalacao.pausar] atividade da pausa não foi gravada", {
      conversation_id: conversationId,
      error: resultado.error,
    });
  }
}
