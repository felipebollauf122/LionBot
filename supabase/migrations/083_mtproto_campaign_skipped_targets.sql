-- Alvos "pulados" e contadores derivados das linhas.
--
-- A tela da campanha mostrava "Enviadas 0 de 316 / Falhas 239" com a lista cheia
-- de alvos enviados. Duas causas, as duas tratadas aqui:
--
-- 1. Os contadores de mtproto_campaigns eram mantidos a mao em seis caminhos
--    (incremento read-then-write do runner, descarte, hot-add, refresh, criacao
--    e reset da recorrencia) e divergiam das linhas de mtproto_targets. Agora
--    um trigger recalcula os quatro contadores a partir das linhas a cada
--    INSERT/UPDATE/DELETE em mtproto_targets. O codigo nao escreve mais
--    sent_count/failed_count/skipped_count/total_targets: quem manda e a linha.
--
-- 2. Destino que nunca vai aceitar a mensagem (canal onde a conta nao e admin,
--    grupo onde ela esta silenciada ou banida, chat restrito, forum sem topico
--    aberto...) virava falha e era retentado a cada ciclo, queimando request e
--    poluindo a tela com codigo cru do MTProto. Agora vira alvo 'skipped' com
--    o motivo, fora do total (a barra de progresso nao trava), e o dialog fica
--    marcado pra nao voltar no proximo rebuild da campanha global.

-- ---------------------------------------------------------------------------
-- mtproto_dialogs: por que nao da pra escrever ali
-- ---------------------------------------------------------------------------
-- write_block: o que as permissoes vistas na SINCRONIZACAO dizem que impede
--   escrever (canal broadcast sem admin, conta silenciada, chat restrito, saiu
--   do grupo...). Sobrescrito a cada sync — se a permissao mudar, volta a null.
-- send_refusal: codigo com que o Telegram RECUSOU um envio de verdade. Fica
--   (sticky): a sincronizacao nao enxerga tudo, e retentar todo ciclo era o
--   problema. Generaliza plain_text_forbidden (081), que so cobria um codigo.
-- is_forum / forum_topic_id: grupo em modo forum precisa de topico. Sem
--   forum_topic_id a mensagem vai pro General; se o General estiver fechado
--   (TOPIC_CLOSED) o worker escolhe um topico aberto e guarda aqui.
alter table public.mtproto_dialogs
  add column write_block text,
  add column send_refusal text,
  add column send_refused_at timestamptz,
  add column is_forum boolean not null default false,
  add column forum_topic_id bigint;

update public.mtproto_dialogs
  set send_refusal = 'CHAT_SEND_PLAIN_FORBIDDEN',
      send_refused_at = coalesce(plain_text_forbidden_at, now())
  where plain_text_forbidden = true;

drop index if exists public.idx_mtproto_dialogs_sendable;

alter table public.mtproto_dialogs
  drop column plain_text_forbidden,
  drop column plain_text_forbidden_at;

-- Os rebuilds de campanha global filtram por (account_id, kind) e pelos dois
-- bloqueios; o indice parcial mantem a query barata.
create index idx_mtproto_dialogs_sendable
  on public.mtproto_dialogs(account_id, kind)
  where write_block is null and send_refusal is null;

-- ---------------------------------------------------------------------------
-- mtproto_targets.status ganha 'skipped'; mtproto_campaigns ganha o contador
-- ---------------------------------------------------------------------------
-- 'pending' | 'sent' | 'failed' | 'skipped'
--   skipped = destino que nao aceita a mensagem desta conta (error_message
--   guarda o codigo). Nao e falha nossa, nao entra no total nem no progresso.
comment on column public.mtproto_targets.status is
  'pending | sent | failed | skipped (destino que nao aceita a mensagem; fora do total)';

alter table public.mtproto_campaigns
  add column skipped_count int not null default 0;

-- ---------------------------------------------------------------------------
-- Contadores derivados: recalculo por statement a partir de mtproto_targets
-- ---------------------------------------------------------------------------
create or replace function public.mtproto_campaigns_recount(p_ids uuid[])
returns void
language sql
set search_path = public
as $$
  update public.mtproto_campaigns c
  set total_targets = coalesce(s.total, 0),
      sent_count    = coalesce(s.sent, 0),
      failed_count  = coalesce(s.failed, 0),
      skipped_count = coalesce(s.skipped, 0)
  from unnest(p_ids) as ids(id)
  left join lateral (
    select count(*) filter (where t.status <> 'skipped') as total,
           count(*) filter (where t.status = 'sent')     as sent,
           count(*) filter (where t.status = 'failed')   as failed,
           count(*) filter (where t.status = 'skipped')  as skipped
    from public.mtproto_targets t
    where t.campaign_id = ids.id
  ) s on true
  where c.id = ids.id;
$$;

-- Tres funcoes (uma por operacao) em vez de uma com IF tg_op: cada uma so
-- referencia a transition table que existe pra ela.
create or replace function public.mtproto_targets_recount_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(distinct campaign_id) into ids from new_rows;
  if ids is not null then
    perform public.mtproto_campaigns_recount(ids);
  end if;
  return null;
end;
$$;

create or replace function public.mtproto_targets_recount_on_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(distinct campaign_id) into ids
  from (select campaign_id from new_rows union select campaign_id from old_rows) u;
  if ids is not null then
    perform public.mtproto_campaigns_recount(ids);
  end if;
  return null;
end;
$$;

create or replace function public.mtproto_targets_recount_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(distinct campaign_id) into ids from old_rows;
  if ids is not null then
    perform public.mtproto_campaigns_recount(ids);
  end if;
  return null;
end;
$$;

create trigger mtproto_targets_recount_insert
  after insert on public.mtproto_targets
  referencing new table as new_rows
  for each statement execute function public.mtproto_targets_recount_on_insert();

create trigger mtproto_targets_recount_update
  after update on public.mtproto_targets
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.mtproto_targets_recount_on_update();

create trigger mtproto_targets_recount_delete
  after delete on public.mtproto_targets
  referencing old table as old_rows
  for each statement execute function public.mtproto_targets_recount_on_delete();

-- Corrige o que ja esta no banco (e o "0 de 316" da tela): a partir daqui os
-- contadores de toda campanha batem com as linhas.
select public.mtproto_campaigns_recount(array(select id from public.mtproto_campaigns));
