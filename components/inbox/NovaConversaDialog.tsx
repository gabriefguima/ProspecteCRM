"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { useContactList } from "@/hooks/contacts/useContactList";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { parseDialablePhone, phoneToWhatsappId } from "@/lib/messaging/contact-card";
import { MagnifyingGlass, UserCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/types/contacts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A conversa nasce já selecionada na tela — a mesma seleção local do InboxLayout. */
  onCreated: (conversationId: string) => void;
}

interface StartManualResponse {
  data: { conversation_id: string; contact_id: string };
}

function displayName(c: Contact): string {
  return c.display_name ?? c.name ?? c.phone_number ?? "Sem nome";
}

/**
 * "Nova conversa": escolher um contato da base (ou criar um com nome+telefone)
 * e escrever a primeira mensagem. Mesmo padrão de busca/criação do
 * `ContactPickerDialog` — mas esta tela COMEÇA um atendimento, então a
 * conversa nasce com o agente de IA pausado (contacts.force_human=true, via
 * `POST /conversations/start-manual` → lib/escalacao/pausar.ts): quem
 * escreveu foi um humano, e o agente não deveria assumir uma conversa que
 * não começou.
 */
export function NovaConversaDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<{ contactId?: string; name: string; phone: string } | null>(
    null,
  );
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [body, setBody] = useState("");
  const [channelSessionId, setChannelSessionId] = useState<string>("");

  const sessions = useChannelSessions();
  const availableSessions = (sessions.data ?? []).filter((s) => s.status === "WORKING");

  useEffect(() => {
    if (!channelSessionId && availableSessions.length === 1) {
      setChannelSessionId(availableSessions[0]!.id);
    }
  }, [availableSessions, channelSessionId]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebounced("");
      setSelected(null);
      setManualName("");
      setManualPhone("");
      setBody("");
      setChannelSessionId("");
    } else {
      const t = setTimeout(() => setDebounced(search.trim()), 250);
      return () => clearTimeout(t);
    }
  }, [search, open]);

  const searchPhone = parseDialablePhone(debounced);
  useEffect(() => {
    if (searchPhone && !selected) setManualPhone(searchPhone);
  }, [searchPhone, selected]);

  const list = useContactList({ search: debounced || undefined });
  const contacts =
    list.data?.pages.flatMap((p) => p.data).filter((c) => {
      if (c.is_anonymized) return false;
      return Boolean(c.phone_number);
    }) ?? [];

  const resolvedManualPhone = parseDialablePhone(manualPhone);
  const phoneAlreadyInList =
    resolvedManualPhone &&
    contacts.some(
      (c) => c.phone_number && phoneToWhatsappId(c.phone_number) === phoneToWhatsappId(resolvedManualPhone),
    );

  const start = useMutation({
    mutationFn: async () => {
      if (!channelSessionId) throw new Error("Escolha um número de WhatsApp.");
      if (!selected) throw new Error("Escolha ou informe um contato.");
      if (!body.trim()) throw new Error("Escreva a primeira mensagem.");
      return apiClient.post<StartManualResponse>("/api/v1/conversations/start-manual", {
        channel_session_id: channelSessionId,
        contact_id: selected.contactId,
        phone_number: selected.contactId ? undefined : selected.phone,
        name: selected.contactId ? undefined : selected.name,
        body: body.trim(),
      });
    },
    onError: (err) => showApiError(err),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      onCreated(res.data.conversation_id);
      onOpenChange(false);
    },
  });

  function pickFromDb(c: Contact) {
    setSelected({ contactId: c.id, name: displayName(c), phone: c.phone_number! });
  }

  function pickManual() {
    if (!resolvedManualPhone) return;
    setSelected({ name: manualName.trim() || resolvedManualPhone, phone: resolvedManualPhone });
  }

  const showManualForm = contacts.length === 0 || Boolean(searchPhone) || manualPhone.length > 0;
  const podeEnviar = Boolean(selected && channelSessionId && body.trim()) && !start.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Escolha um contato da base ou informe nome e telefone de um novo — e escreva a
            primeira mensagem.
          </DialogDescription>
        </DialogHeader>

        {availableSessions.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="nova-conversa-canal">Enviar por</Label>
            <Select value={channelSessionId || undefined} onValueChange={setChannelSessionId}>
              <SelectTrigger id="nova-conversa-canal" className="h-9 text-sm">
                <SelectValue placeholder="Escolha o número" />
              </SelectTrigger>
              <SelectContent>
                {availableSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {channelLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {availableSessions.length === 0 && !sessions.isLoading && (
          <p className="text-xs text-destructive">
            Nenhum número de WhatsApp conectado — conecte um em Canais antes de iniciar uma
            conversa.
          </p>
        )}

        {selected ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <UserCircle size={22} weight="duotone" className="text-primary" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{selected.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{selected.phone}</span>
              </span>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Trocar
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <MagnifyingGlass
                size={16}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone…"
                className="pl-8"
                autoFocus
              />
            </div>

            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              {list.isLoading && contacts.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando…</p>
              ) : contacts.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {debounced ? "Nenhum contato encontrado na base." : "Nenhum contato com telefone na base."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {contacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm",
                          "hover:bg-muted",
                        )}
                        onClick={() => pickFromDb(c)}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                          <UserCircle size={22} weight="duotone" className="text-primary" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{displayName(c)}</span>
                          {c.phone_number && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.phone_number}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {showManualForm && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {searchPhone && !phoneAlreadyInList ? "Usar número informado" : "Ou informe um contato novo"}
                </p>
                {searchPhone && !phoneAlreadyInList && (
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left text-sm",
                      "hover:bg-muted",
                    )}
                    onClick={pickManual}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <UserCircle size={22} weight="duotone" className="text-primary" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{manualName.trim() || searchPhone}</span>
                      <span className="block truncate text-xs text-muted-foreground">{searchPhone}</span>
                    </span>
                  </button>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="nova-conversa-nome">Nome (opcional)</Label>
                  <Input
                    id="nova-conversa-nome"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Como você quer identificar"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nova-conversa-telefone">Telefone</Label>
                  <Input
                    id="nova-conversa-telefone"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="+55 32 98479-3302"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={!resolvedManualPhone}
                  onClick={pickManual}
                >
                  Usar este contato
                </Button>
              </div>
            )}
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="nova-conversa-mensagem">Primeira mensagem</Label>
          <Textarea
            id="nova-conversa-mensagem"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva a mensagem inicial…"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={start.isPending}>
            Cancelar
          </Button>
          <Button type="button" disabled={!podeEnviar} onClick={() => start.mutate()}>
            {start.isPending ? "Enviando..." : "Iniciar conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
