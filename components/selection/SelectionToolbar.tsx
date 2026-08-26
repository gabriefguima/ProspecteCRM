"use client";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface SelectionToolbarProps {
  count: number;
  onClear: () => void;
  children?: ReactNode;
}

/**
 * Casca genérica da barra de ações em lote — extraída de
 * components/kanban/BulkActionBar.tsx. Cada tela injeta suas próprias ações
 * como children; esta casca só cuida de: aparecer/sumir conforme a contagem,
 * Esc para limpar, e o botão Cancelar.
 *
 * `max-w-[calc(100vw-2rem)]` + `flex-wrap` (em vez de só `w-fit`) evitam o
 * vazamento de scroll horizontal da PÁGINA inteira em telas estreitas — a
 * barra é `mx-auto` e `sticky`, então o excesso ficava invisível dos dois
 * lados, não só cortado.
 */
export function SelectionToolbar({ count, onClear, children }: SelectionToolbarProps) {
  useEffect(() => {
    if (count === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [count, onClear]);

  if (count === 0) return null;

  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-md">
      <span className="text-sm font-medium">
        {count} selecionado{count > 1 ? "s" : ""}
      </span>
      {children}
      <Button size="sm" variant="ghost" onClick={onClear}>
        Cancelar
      </Button>
    </div>
  );
}
