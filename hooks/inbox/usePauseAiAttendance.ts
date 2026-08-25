"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface PauseArgs {
  conversation_id: string;
}

interface PauseResponse {
  data: { paused: boolean; already_paused: boolean };
}

/**
 * Pausa o atendimento automático manualmente — a irmã de `useResumeAiAttendance`.
 * Grava `contacts.force_human = true` (lib/escalacao/pausar.ts): o agente não
 * responde mais nessa conversa, mesmo que o contato escreva de novo, até
 * alguém devolver pelo botão "Devolver ao automático".
 */
export function usePauseAiAttendance() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: PauseArgs) =>
      apiClient.post<PauseResponse>(`/api/v1/conversations/${args.conversation_id}/pause-bot`, {}),
    onError: (err) => showApiError(err),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}
