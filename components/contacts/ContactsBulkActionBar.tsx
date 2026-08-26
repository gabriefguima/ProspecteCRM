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
import { useBulkContactAction } from "@/hooks/contacts/useBulkContactAction";

interface ContactsBulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
}

export function ContactsBulkActionBar({ selectedIds, onClear }: ContactsBulkActionBarProps) {
  const bulk = useBulkContactAction();
  const [tagInput, setTagInput] = useState("");

  const runTagAdd = () => {
    const t = tagInput.trim();
    if (!t) return;
    bulk.mutate(
      { action: "tag", contact_ids: selectedIds, params: { add: [t] } },
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
