"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { BulkContactActionInput } from "@/lib/schemas/contacts";

export function useBulkContactAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkContactActionInput) =>
      apiClient.post<{ data: { updated_count: number } }>("/api/v1/contacts/bulk", input),
    onError: showApiError,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
