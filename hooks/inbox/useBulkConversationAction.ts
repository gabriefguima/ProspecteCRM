"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { BulkConversationActionInput } from "@/lib/schemas/messaging";

export function useBulkConversationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkConversationActionInput) =>
      apiClient.post<{ data: { updated_count: number } }>("/api/v1/conversations/bulk", input),
    onError: showApiError,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
