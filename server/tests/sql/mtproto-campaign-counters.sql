-- Valida a migration 083 num PostgreSQL descartavel (ver
-- server/scripts/test-mtproto-campaign-counters.ps1). Aplica as migrations
-- MTProto na ordem, planta um cenario e confere:
--   - contadores de mtproto_campaigns seguem as linhas de mtproto_targets
--   - 'skipped' fica fora do total
--   - plain_text_forbidden (081) vira send_refusal
--   - o reset da recorrencia com o filtro corrigido devolve 'sent' pra pending
\set ON_ERROR_STOP on

-- Stubs do que as migrations referenciam e nao vem do Supabase local.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create table if not exists public.tenants (id uuid primary key default gen_random_uuid());

\i /tmp/migrations/016_mtproto.sql
\i /tmp/migrations/023_mtproto_dialogs.sql
\i /tmp/migrations/024_mtproto_campaign_recurrence.sql
\i /tmp/migrations/025_mtproto_campaign_global.sql
\i /tmp/migrations/030_mtproto_campaign_processing_lock.sql
\i /tmp/migrations/035_mtproto_targets_retry_after.sql
\i /tmp/migrations/080_mtproto_campaign_recurrence_minutes.sql
\i /tmp/migrations/081_mtproto_dialogs_plain_text_forbidden.sql
\i /tmp/migrations/082_mtproto_campaign_recurrence_seconds.sql

-- Cenario ANTES da 083: campanha com contadores errados (como o "0 de 316")
-- e um dialog marcado pelo mecanismo antigo.
insert into public.tenants (id) values ('00000000-0000-0000-0000-000000000001');
insert into public.mtproto_accounts (id, tenant_id, phone_number, status)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '+5511999999999', 'active');
insert into public.mtproto_dialogs (id, account_id, peer_id, peer_type, kind, title, plain_text_forbidden, plain_text_forbidden_at)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', '100', 'channel', 'group_member', 'sem texto', true, '2026-09-01T00:00:00Z'),
         ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000a', '200', 'channel', 'group_member', 'normal', false, null);
insert into public.mtproto_campaigns (id, tenant_id, name, message_text, total_targets, sent_count, failed_count)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'pre', 'oi', 316, 0, 239);
insert into public.mtproto_targets (campaign_id, target_identifier, target_type, status, error_message) values
  ('00000000-0000-0000-0000-0000000000c1', 'a', 'username', 'sent', null),
  ('00000000-0000-0000-0000-0000000000c1', 'b', 'username', 'sent', null),
  ('00000000-0000-0000-0000-0000000000c1', 'c', 'username', 'failed', '403: CHAT_WRITE_FORBIDDEN (caused by messages.SendMessage)'),
  ('00000000-0000-0000-0000-0000000000c1', 'd', 'username', 'failed', 'invalid_identifier'),
  ('00000000-0000-0000-0000-0000000000c1', 'e', 'username', 'pending', null);

\i /tmp/migrations/083_mtproto_campaign_skipped_targets.sql
\i /tmp/migrations/084_mtproto_campaign_counter_concurrency.sql

-- 1. O backfill da migration ja corrige a campanha existente.
do $$
declare c record;
begin
  select * into c from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c1';
  if c.total_targets <> 5 or c.sent_count <> 2 or c.failed_count <> 2 or c.skipped_count <> 0 then
    raise exception 'backfill errado: total=% sent=% failed=% skipped=%', c.total_targets, c.sent_count, c.failed_count, c.skipped_count;
  end if;
end $$;

-- 2. plain_text_forbidden virou send_refusal, com a data preservada.
do $$
declare d record;
begin
  select * into d from public.mtproto_dialogs where id = '00000000-0000-0000-0000-0000000000d1';
  if d.send_refusal is distinct from 'CHAT_SEND_PLAIN_FORBIDDEN' or d.send_refused_at <> '2026-09-01T00:00:00Z' then
    raise exception 'send_refusal nao migrado: % / %', d.send_refusal, d.send_refused_at;
  end if;
  select * into d from public.mtproto_dialogs where id = '00000000-0000-0000-0000-0000000000d2';
  if d.send_refusal is not null or d.write_block is not null or d.is_forum then
    raise exception 'dialog normal ganhou bloqueio indevido';
  end if;
end $$;

-- 3. INSERT em lote: skipped entra no skipped_count e fica fora do total.
insert into public.mtproto_targets (campaign_id, target_identifier, target_type, status, error_message) values
  ('00000000-0000-0000-0000-0000000000c1', 'f', 'username', 'skipped', 'CHAT_ADMIN_REQUIRED'),
  ('00000000-0000-0000-0000-0000000000c1', 'g', 'username', 'skipped', 'USER_BANNED_IN_CHANNEL'),
  ('00000000-0000-0000-0000-0000000000c1', 'h', 'username', 'pending', null);
do $$
declare c record;
begin
  select * into c from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c1';
  if c.total_targets <> 6 or c.skipped_count <> 2 or c.sent_count <> 2 or c.failed_count <> 2 then
    raise exception 'insert: total=% sent=% failed=% skipped=%', c.total_targets, c.sent_count, c.failed_count, c.skipped_count;
  end if;
end $$;

-- 4. UPDATE de status (envio concluido) reflete nos contadores.
update public.mtproto_targets set status = 'sent', sent_at = now()
  where campaign_id = '00000000-0000-0000-0000-0000000000c1' and target_identifier = 'e';
do $$
declare c record;
begin
  select * into c from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c1';
  if c.sent_count <> 3 then
    raise exception 'update: sent_count=% (esperado 3)', c.sent_count;
  end if;
end $$;

-- 5. Reset da recorrencia com o filtro CORRIGIDO: 'sent' e falha recuperavel
--    voltam pra pending; invalid_identifier e skipped ficam onde estao.
update public.mtproto_targets
  set status = 'pending', sent_at = null, error_message = null
  where campaign_id = '00000000-0000-0000-0000-0000000000c1'
    and status in ('sent', 'failed')
    and (error_message is null or error_message <> 'invalid_identifier');
do $$
declare c record; n_pending int; n_skipped int; n_invalid int;
begin
  select * into c from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c1';
  select count(*) into n_pending from public.mtproto_targets where campaign_id = c.id and status = 'pending';
  select count(*) into n_skipped from public.mtproto_targets where campaign_id = c.id and status = 'skipped';
  select count(*) into n_invalid from public.mtproto_targets where campaign_id = c.id and error_message = 'invalid_identifier';
  if n_pending <> 5 or n_skipped <> 2 or n_invalid <> 1 then
    raise exception 'reset: pending=% skipped=% invalid=%', n_pending, n_skipped, n_invalid;
  end if;
  if c.sent_count <> 0 or c.failed_count <> 1 or c.total_targets <> 6 or c.skipped_count <> 2 then
    raise exception 'reset contadores: total=% sent=% failed=% skipped=%', c.total_targets, c.sent_count, c.failed_count, c.skipped_count;
  end if;
end $$;

-- 6. DELETE (refresh global apaga pending e skipped) recalcula.
delete from public.mtproto_targets
  where campaign_id = '00000000-0000-0000-0000-0000000000c1' and status in ('pending', 'skipped');
do $$
declare c record;
begin
  select * into c from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c1';
  if c.total_targets <> 1 or c.skipped_count <> 0 or c.failed_count <> 1 or c.sent_count <> 0 then
    raise exception 'delete: total=% sent=% failed=% skipped=%', c.total_targets, c.sent_count, c.failed_count, c.skipped_count;
  end if;
end $$;

-- 7. Apagar a campanha (cascade nos alvos) nao explode no trigger.
delete from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  if exists (select 1 from public.mtproto_targets where campaign_id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'cascade nao apagou os alvos';
  end if;
end $$;

-- 8. O indice parcial novo existe e o antigo nao.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_mtproto_dialogs_sendable'
                 and indexdef ilike '%write_block IS NULL%' and indexdef ilike '%send_refusal IS NULL%') then
    raise exception 'idx_mtproto_dialogs_sendable nao foi recriado com os bloqueios novos';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'mtproto_dialogs' and column_name = 'plain_text_forbidden') then
    raise exception 'plain_text_forbidden ainda existe';
  end if;
end $$;

-- 9. Um envio e o hot-add podem alterar alvos da mesma campanha ao mesmo
-- tempo. Esperar o UPDATE da campanha nao pode gravar uma contagem calculada
-- ANTES do commit do envio. Duas conexoes reais, sincronizadas pelo lock.
create extension if not exists dblink;
insert into public.mtproto_campaigns (id, tenant_id, name, message_text)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'concurrent', 'oi');
insert into public.mtproto_targets (campaign_id, target_identifier, target_type)
  values ('00000000-0000-0000-0000-0000000000c2', 'sending', 'username');

select dblink_connect('sender', 'dbname=counters_test user=postgres');
select dblink_connect('hot_add', 'dbname=counters_test user=postgres application_name=mtproto-counter-hot-add-test options=-cstatement_timeout=15000');
select dblink_exec('sender', 'begin');
select dblink_exec('sender', $$
  update public.mtproto_targets set status = 'sent'
  where campaign_id = '00000000-0000-0000-0000-0000000000c2'
    and target_identifier = 'sending'
$$);
select dblink_send_query('hot_add', $$
  insert into public.mtproto_targets (campaign_id, target_identifier, target_type)
  values ('00000000-0000-0000-0000-0000000000c2', 'new-contact', 'username')
  returning target_identifier
$$);
do $$
declare deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    exit when exists (
      select 1 from pg_stat_activity
      where application_name = 'mtproto-counter-hot-add-test' and wait_event_type = 'Lock'
    );
    if clock_timestamp() > deadline then
      raise exception 'hot-add nao chegou ao lock; concorrencia nao foi exercitada';
    end if;
    perform pg_sleep(0.01);
  end loop;
end $$;
select dblink_exec('sender', 'commit');
select * from dblink_get_result('hot_add') as r(target_identifier text);
select dblink_disconnect('sender');
select dblink_disconnect('hot_add');
do $$
declare c record;
begin
  select * into c from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c2';
  if c.total_targets <> 2 or c.sent_count <> 1 or c.failed_count <> 0 or c.skipped_count <> 0 then
    raise exception 'envio + hot-add concorrentes: total=% sent=% failed=% skipped=% (esperado 2/1/0/0)', c.total_targets, c.sent_count, c.failed_count, c.skipped_count;
  end if;
end $$;
delete from public.mtproto_campaigns where id = '00000000-0000-0000-0000-0000000000c2';

select 'mtproto-campaign-counters: OK' as resultado;
