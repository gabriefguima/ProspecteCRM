"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelectionToolbar } from "@/components/selection/SelectionToolbar";
import { useBulkConversationAction } from "@/hooks/inbox/useBulkConversationAction";

interface InboxBulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
}

export function InboxBulkActionBar({ selectedIds, onClear }: InboxBulkActionBarProps) {
  const bulk = useBulkConversationAction();
  const [tagInput, setTagInput] = useState("");

  const runSetStatus = (status: "closed" | "archived") => {
    bulk.mutate(
      { action: "set_status", conversation_ids: selectedIds, params: { status } },
      { onSuccess: () => onClear() },
    );
  };

  const runMarkRead = () => {
    bulk.mutate(
      { action: "mark_read", conversation_ids: selectedIds, params: {} },
      { onSuccess: () => onClear() },
    );
  };

  const runTagAdd = () => {
    const t = tagInput.trim();
    if (!t) return;
    bulk.mutate(
      { action: "tag", conversation_ids: selectedIds, params: { add: [t] } },
      {
        onSuccess: () => {
          setTagInput("");
          onClear();
        },
      },
    );
  };

  return (
    <SelectionToolbar count={selectedIds.length} onClear={onClear}>
      <Button size="sm" variant="outline" onClick={runMarkRead} disabled={bulk.isPending}>
        Marcar como lido
      </Button>

      <Button size="sm" variant="outline" onClick={() => runSetStatus("closed")} disabled={bulk.isPending}>
        Fechar
      </Button>

      <Button size="sm" variant="outline" onClick={() => runSetStatus("archived")} disabled={bulk.isPending}>
        Arquivar
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={bulk.isPending}>
            Tag…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <div className="flex items-center gap-2 p-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="nova tag"
              className="h-8 w-40"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runTagAdd();
                }
              }}
            />
            <Button size="sm" onClick={runTagAdd} disabled={!tagInput.trim()}>
              Adicionar
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </SelectionToolbar>
  );
}
