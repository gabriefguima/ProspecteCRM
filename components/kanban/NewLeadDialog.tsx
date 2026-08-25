"use client";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateLead } from "@/hooks/kanban/useCreateLead";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import { usePermission } from "@/hooks/auth/AuthProvider";
import type { Stage } from "@/lib/kanban/types";
import { createLeadSchema, type CreateLeadInput } from "@/lib/schemas/leads";
import { parseReaisToCents } from "@/lib/money";
import { EcoDoValor } from "./EcoDoValor";

interface FormShape {
  title: string;
  description: string;
  stage_id: string;
  valueReais: string;
  tagsRaw: string;
  expected_close_date: string;
  /**
   * Um campo só, não dois — "none" | "user:<id>" | "agent:<id>". A API trata
   * owner_user_id/owner_agent_id como MUTUAMENTE EXCLUSIVOS (mandar os dois
   * não-nulos é 422); codificar como string única torna essa exclusão
   * estrutural, em vez de depender de zerar um campo quando o outro muda.
   */
  owner: string;
}

const SEM_RESPONSAVEL = "none";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelineId: string;
  stages: Stage[];
  /** Vincula o lead criado a este contato de origem (ex.: painel do Inbox). */
  contactId?: string | null;
}

function defaultStageId(stages: Stage[]): string {
  const open = stages.find((s) => !s.is_won && !s.is_lost && !s.is_archived);
  return open?.id ?? stages[0]?.id ?? "";
}

export function NewLeadDialog({ open, onOpenChange, pipelineId, stages, contactId }: Props) {
  const create = useCreateLead(pipelineId);
  const initialStage = useMemo(() => defaultStageId(stages), [stages]);

  // Mesmo par de hooks e mesma permissão do menu "Responsável" no card do
  // Kanban (KanbanCardActions.tsx) — a lista de quem pode ser dono é UMA só,
  // vivendo num lugar só; reescrevê-la aqui divergiria na primeira mudança.
  const canAssign = usePermission("pipeline.move_card");
  const { data: members } = useAssignableMembers(canAssign && open);
  const { data: agents } = useAssignableAgents(canAssign && open);

  const form = useForm<FormShape>({
    defaultValues: {
      title: "",
      description: "",
      stage_id: initialStage,
      valueReais: "",
      tagsRaw: "",
      expected_close_date: "",
      owner: SEM_RESPONSAVEL,
    },
  });

  // Reset stage_id default if stages change while dialog mounted.
  useEffect(() => {
    if (!form.getValues("stage_id") && initialStage) {
      form.setValue("stage_id", initialStage);
    }
  }, [initialStage, form]);

  async function onSubmit(values: FormShape) {
    const tags = values.tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reais = values.valueReais.trim();
    let valueCents: number | null = null;
    if (reais.length > 0) {
      valueCents = parseReaisToCents(reais);
      if (valueCents === null) {
        form.setError("valueReais", { message: "Valor inválido" });
        return;
      }
    }

    const payload: Record<string, unknown> = {
      pipeline_id: pipelineId,
      stage_id: values.stage_id,
      title: values.title.trim(),
      currency: "BRL",
      source: "manual",
      tags,
    };
    if (contactId) payload.contact_id = contactId;
    if (values.description.trim()) payload.description = values.description.trim();
    if (valueCents !== null) payload.value_cents = valueCents;
    if (values.expected_close_date) payload.expected_close_date = values.expected_close_date;
    if (values.owner.startsWith("user:")) payload.owner_user_id = values.owner.slice(5);
    else if (values.owner.startsWith("agent:")) payload.owner_agent_id = values.owner.slice(6);

    const parsed = createLeadSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Dados inválidos");
      return;
    }

    try {
      await create.mutateAsync(parsed.data as CreateLeadInput);
      toast.success("Lead criado");
      form.reset({
        title: "",
        description: "",
        stage_id: initialStage,
        valueReais: "",
        tagsRaw: "",
        expected_close_date: "",
        owner: SEM_RESPONSAVEL,
      });
      onOpenChange(false);
    } catch {
      // toast already shown
    }
  }

  const stageId = form.watch("stage_id");
  const owner = form.watch("owner");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Lead</DialogTitle>
          <DialogDescription>
            Crie um lead manualmente neste pipeline.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Pedido Maria — combo presente"
              {...form.register("title", { required: true, minLength: 2 })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="Contexto, observações, links…"
              {...form.register("description")}
            />
          </div>

          <div className="space-y-2">
            <Label>Etapa</Label>
            <Select
              value={stageId}
              onValueChange={(v) => form.setValue("stage_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa" />
              </SelectTrigger>
              <SelectContent>
                {stages
                  .filter((s) => !s.is_archived)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {canAssign && (
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={owner} onValueChange={(v) => form.setValue("owner", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_RESPONSAVEL}>Sem responsável</SelectItem>
                  {(members ?? []).map((m) => (
                    <SelectItem key={m.user_id} value={`user:${m.user_id}`}>
                      {m.full_name ?? "Sem nome"}
                    </SelectItem>
                  ))}
                  {(agents ?? []).map((a) => (
                    <SelectItem key={a.agent_id} value={`agent:${a.agent_id}`}>
                      {a.name}
                      {a.version_number != null ? ` · v${a.version_number}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="valueReais">Valor (R$)</Label>
              <Input
                id="valueReais"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("valueReais")}
              />
              <EcoDoValor control={form.control} />
              {form.formState.errors.valueReais && (
                <p className="text-xs text-error-fg">
                  {form.formState.errors.valueReais.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="expected_close_date">Fechamento previsto</Label>
              <Input
                id="expected_close_date"
                type="date"
                {...form.register("expected_close_date")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tagsRaw">Tags (separadas por vírgula)</Label>
            <Input
              id="tagsRaw"
              placeholder="vip, recompra"
              {...form.register("tagsRaw")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || !stageId}>
              {create.isPending ? "Criando…" : "Criar lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
