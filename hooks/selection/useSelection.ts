"use client";
import { useCallback, useMemo, useState } from "react";

/**
 * Seleção múltipla genérica (checkbox por item + contagem para a barra de
 * ações). `toggle` é sempre aditivo — marcar/desmarcar um item nunca afeta os
 * outros, ao contrário do gesto de Cmd/Ctrl+click do Kanban (que também passa
 * a chamar `toggle`, unificando os dois caminhos).
 *
 * `isActive` controla se os checkboxes aparecem na tela — por padrão ficam
 * escondidos (interface poluída era o problema relatado). Fica ativo se o
 * usuário clicou em "Selecionar" OU se já existe algo marcado (ex.: o atalho
 * Ctrl+click do Kanban) — nunca existe item marcado com o checkbox escondido,
 * senão a marcação vira estado invisível.
 */
export function useSelection() {
  const [manualActive, setManualActive] = useState(false);
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

  const activate = useCallback(() => setManualActive(true), []);

  /**
   * Sai do modo seleção por completo: esconde os checkboxes E limpa a
   * marcação. É o que o botão "Selecionar"/"Cancelar seleção" do cabeçalho e
   * o "Cancelar"/Esc da barra de ações chamam — os dois efeitos sempre andam
   * juntos, nunca faz sentido limpar a marcação sem sair do modo (ela
   * reapareceria escondida por trás de um checkbox que já sumiu).
   */
  const exit = useCallback(() => {
    setManualActive(false);
    setSelected(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return {
    isActive: manualActive || selected.size > 0,
    activate,
    exit,
    selectedIds,
    isSelected,
    toggle,
    selectAll,
    count: selected.size,
  };
}
