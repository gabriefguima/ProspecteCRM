-- ============================================================================
-- 0169 — LEAD ÚNICO POR CONTATO ABERTO.
--
-- Medido em produção, 2026-08-25: um contato que manda 2-3 mensagens em
-- rajada (poucas centenas de ms entre uma e outra) ganhava 2-3 cards no
-- Kanban, todos na etapa de entrada. Cada mensagem chega como um webhook WAHA
-- SEPARADO (`app/api/v1/webhooks/waha/[token]/route.ts`, um por mensagem), e
-- o Node processa requisições concorrentes de forma assíncrona — então
-- `garantirLeadDaConversa` (`lib/leads/nascimento-do-lead.ts`) corria um
-- clássico check-then-act sem trava nenhuma: o SELECT de uma requisição não
-- via o INSERT da outra, que ainda não tinha commitado, e as duas concluíam
-- "não existe lead aberto" — cada uma inseria o seu.
--
-- O código já *pretendia* ser idempotente (comentário do arquivo: "chamar de
-- novo não cria um segundo card"), mas sem um constraint de banco isso é
-- promessa em memória, não garantia. A trava certa é a mesma receita já usada
-- em `gatilho-caso.ts` e `zernio/ingest.ts`: unique index parcial + o
-- chamador tratando `23505` como "já existe" (feito em
-- `lib/leads/nascimento-do-lead.ts`, junto deste commit).
--
-- ─── Dedup ANTES da trava ───────────────────────────────────────────────────
--
-- Constraint nova falha se dados atuais a violam (doutrina de migrations,
-- item 8). Sobrevive o lead mais ANTIGO por (organization_id, contact_id)
-- entre os `open` — é a demanda original; as réplicas nascidas da corrida
-- viram `lost`.
--
-- `lost_reason` é vocabulário FECHADO (`fn_validate_lost_reason_required`
-- só aceita a lista canônica ou os extras do pipeline) — não dá para gravar
-- uma frase livre ali. Usa-se o canônico `other`, e o motivo de verdade fica
-- em `custom_fields._dedupe_note`, legível na tela e sem inventar um valor de
-- enum que um clone com pipeline diferente poderia rejeitar.
--
-- Genérico para QUALQUER banco de clone (doutrina item 4): não referencia
-- nenhum id de tenant, organização ou lead desta instalação.
-- ============================================================================

with duplicados as (
  select id,
         row_number() over (
           partition by organization_id, contact_id
           order by created_at asc, id asc
         ) as posicao
  from public.crm_leads
  where status = 'open' and contact_id is not null
)
update public.crm_leads l
set status = 'lost',
    lost_reason = 'other',
    closed_at = now(),
    custom_fields = l.custom_fields || jsonb_build_object(
      '_dedupe_note',
      'Lead duplicado por corrida de concorrência na ingestão (mensagens quase ' ||
      'simultâneas do mesmo contato) — arquivado em favor do lead mais antigo ' ||
      'da mesma demanda. Ver migration 0169.'
    )
from duplicados d
where d.id = l.id
  and d.posicao > 1
  and l.status = 'open';

-- A trava: nunca mais que um lead `open` por contato na mesma organização.
-- `where status = 'open' and contact_id is not null`: lead sem contato
-- (cadastro manual avulso) não entra na regra — "um por demanda" pressupõe
-- que há um contato para ser dono da demanda.
create unique index if not exists uniq_crm_leads_org_contact_aberto
  on public.crm_leads (organization_id, contact_id)
  where status = 'open' and contact_id is not null;

comment on index public.uniq_crm_leads_org_contact_aberto is
  'Um lead aberto por contato, por organização. Ingestão concorrente '
  '(múltiplas mensagens quase simultâneas) confia nesta trava, não só no '
  'SELECT-antes-do-INSERT de garantirLeadDaConversa — ver migration 0169.';
