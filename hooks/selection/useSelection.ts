"use client";
import { useCallback, useMemo, useState } from "react";

/**
 * Seleção múltipla genérica (checkbox por item + contagem para a barra de
 * ações). `toggle` é sempre aditivo — marcar/desmarcar um item nunca afeta os
 * outros, ao contrário do gesto de Cmd/Ctrl+click do Kanban (que também passa
 * a chamar `toggle`, unificando os dois caminhos).
 */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return { selectedIds, isSelected, toggle, selectAll, clear, count: selected.size };
}
