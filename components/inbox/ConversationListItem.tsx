"use client";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Phone, Robot } from "@/lib/ui/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onSelect: (id: string) => void;
  /** Posição 1-based na fila (G5-03). Presente só na visão Fila. */
  queuePosition?: number;
  /**
   * Mostrar POR ONDE a conversa entrou.
   *
   * Só com mais de um número conectado. Com um só, o rótulo seria a mesma
   * palavra em toda linha da lista — ruído que ensina o olho a ignorar a área
   * onde vivem os avisos que importam (bloqueado, tags).
   */
  mostrarCanal?: boolean;
  /**
   * Seleção em lote (checkbox) — conceito INDEPENDENTE de `isSelected`
   * (que é "esta é a conversa aberta no painel"). As duas nunca se misturam:
   * uma conversa pode estar marcada para ação em lote sem estar aberta, e
   * vice-versa.
   */
  isChecked?: boolean;
  onToggleCheck?: (id: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  open: "bg-muted-foreground/60",
  claimed: "bg-blue-500",
  ai_handling: "bg-purple-500",
  closed: "bg-muted-foreground/30",
  archived: "bg-muted-foreground/20",
};

function initials(name: string | null | undefined, fallback: string): string {
  const v = (name ?? "").trim();
  if (!v) return fallback.slice(0, 2).toUpperCase();
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return format(d, "HH:mm");
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return formatDistanceToNowStrict(d, { addSuffix: false, locale: ptBR });
  return format(d, "dd/MM");
}

/** "Aguardando há 5 min" — desde a última mensagem do cliente (fallback: criação). */
function waitingLabel(conversation: ConversationWithContact): string {
  const since = conversation.last_inbound_at ?? conversation.created_at;
  if (!since) return "Aguardando";
  return `Aguardando ${formatDistanceToNowStrict(new Date(since), { addSuffix: true, locale: ptBR })}`;
}

export function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
  queuePosition,
  mostrarCanal,
  isChecked = false,
  onToggleCheck,
}: Props) {
  const c = conversation.contacts ?? null;
  const displayName = rotuloDoContato(c);
  const phoneFallback = c?.phone_number ?? "??";
  const tags = c?.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const overflow = tags.length - visibleTags.length;
  const preview = conversation.last_message_preview?.trim() || "Sem mensagens";
  const truncated = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
  const time = relativeTime(conversation.last_message_at);
  const unread = conversation.unread_count_for_assignee ?? 0;
  const dot = STATUS_DOT[conversation.status] ?? STATUS_DOT.open;
  const isAi = conversation.status === "ai_handling";

  // O número DA EMPRESA por onde esta conversa chegou — não o do cliente. Com
  // dois canais é o que decide o tom da resposta e qual número a pessoa vê
  // respondendo. Cai no nome do canal quando não há número (canal recém-criado).
  const canal = conversation.channel_sessions ?? null;
  const rotuloCanal = canal?.phone_number ?? canal?.display_name ?? null;

  return (
    // Era um <button> inteiro; virou role="button" porque o checkbox de
    // seleção em lote precisou entrar como irmão do avatar — dois
    // interativos aninhados (checkbox dentro de button) é HTML inválido.
    // Mesma solução já usada em KanbanCard.tsx (role="group" no card,
    // elemento ativável coberto por onClick/onKeyDown aqui).
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(conversation.id);
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-accent/40",
        isSelected && "bg-accent/60",
      )}
      aria-current={isSelected ? "true" : undefined}
    >
      {onToggleCheck && (
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleCheck(conversation.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Selecionar conversa com ${displayName}`}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
        />
      )}
      <div className="relative shrink-0">
        <Avatar className="h-10 w-10">
          {/* Só monta a <img> quando existe arquivo: sem isso o browser pediria
              a rota para TODO contato da lista e levaria 404 em cada um sem
              foto — que é a maioria. O AvatarFallback do Radix já cobre o caso
              de a imagem não carregar, então as iniciais nunca somem. */}
          {c?.avatar_storage_path && !c?.is_anonymized ? (
            <AvatarImage
              src={`/api/v1/contacts/${c.id}/avatar`}
              alt=""
              className="object-cover"
            />
          ) : null}
          <AvatarFallback className="text-xs">
            {initials(displayName, phoneFallback)}
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background",
            dot,
          )}
          aria-hidden
        />
      </div>

      <div className="min-w-0 flex-1">
        {queuePosition !== undefined && (
          <div className="mb-1 flex items-center gap-1.5">
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-medium tabular-nums text-primary"
              aria-label={`Posição ${queuePosition} na fila`}
            >
              {queuePosition}º
            </span>
            <span className="text-[10px] text-muted-foreground">
              {waitingLabel(conversation)}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              c?.is_anonymized && "italic text-muted-foreground",
            )}
          >
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {time}
          </span>
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {isAi ? <Robot size={10} weight="duotone" className="mr-1 inline" aria-hidden /> : null}
          {truncated}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {visibleTags.map((t) => (
            <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[10px]">
              {t}
            </Badge>
          ))}
          {overflow > 0 && (
            <span className="text-[10px] text-muted-foreground">+{overflow}</span>
          )}
          {mostrarCanal && rotuloCanal && (
            <Badge
              variant="outline"
              className="h-4 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground"
              title={`Entrou por ${rotuloCanal}`}
            >
              <Phone size={9} weight="regular" aria-hidden />
              {rotuloCanal}
            </Badge>
          )}
          {c?.is_blocked && (
            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
              Bloqueado
            </Badge>
          )}
          {c?.is_anonymized && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              Anonimizado
            </Badge>
          )}
          {unread > 0 && (
            <Badge className="ml-auto h-4 min-w-4 px-1.5 text-[10px]">{unread}</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
