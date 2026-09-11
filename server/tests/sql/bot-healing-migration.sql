\set ON_ERROR_STOP on
create extension pgcrypto;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.tenants (id uuid primary key);
create table public.bots (id uuid primary key, tenant_id uuid references tenants(id), telegram_token text, bot_username text, webhook_url text, is_active boolean);
create table public.mtproto_accounts (id uuid primary key, tenant_id uuid references tenants(id));
create table public.leads (id uuid primary key, bot_id uuid references bots(id), history text);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
\i /tmp/076_bot_auto_healing.sql

insert into tenants values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
insert into bots values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'old-token', 'oldbot', 'old-webhook', true);
insert into mtproto_accounts values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
insert into leads values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'preserved history');
insert into bot_recovery_settings (bot_id) values ('20000000-0000-0000-0000-000000000001');
update bot_recovery_settings set identity = '{"name":"Loja","username":"oldbot","telegramId":123456,"description":"","about":"","photoPath":null}'::jsonb;
insert into bot_recovery_runs (id, bot_id, tenant_id, token_hash, status, account_id, new_token, new_username)
values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', encode(digest('old-token','sha256'),'hex'), 'restoring', '30000000-0000-0000-0000-000000000001', '9876543210:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'newbot');

do $$
declare run_id uuid := '50000000-0000-0000-0000-000000000001';
begin
  if has_table_privilege('authenticated', 'bot_recovery_runs', 'select') then raise exception 'staged tokens readable by authenticated'; end if;
  if has_function_privilege('anon', 'commit_bot_recovery(uuid,text)', 'execute') then raise exception 'anon can commit'; end if;
  if has_function_privilege('authenticated', 'commit_bot_recovery(uuid,text)', 'execute') then raise exception 'authenticated can commit'; end if;
  if not has_function_privilege('service_role', 'commit_bot_recovery(uuid,text)', 'execute') then raise exception 'service cannot commit'; end if;

  update bots set telegram_token = 'manual-token';
  if commit_bot_recovery(run_id, 'new-webhook') then raise exception 'manual token overwritten'; end if;
  if (select telegram_token from bots) <> 'manual-token' then raise exception 'manual token changed'; end if;

  update bots set telegram_token = 'old-token', is_active = false;
  update bot_recovery_runs set status = 'restoring';
  if commit_bot_recovery(run_id, 'new-webhook') then raise exception 'inactive bot reactivated'; end if;

  update bots set is_active = true, tenant_id = '10000000-0000-0000-0000-000000000002';
  update bot_recovery_runs set status = 'restoring';
  if commit_bot_recovery(run_id, 'new-webhook') then raise exception 'transferred bot overwritten'; end if;

  update bots set tenant_id = '10000000-0000-0000-0000-000000000001';
  update mtproto_accounts set tenant_id = '10000000-0000-0000-0000-000000000002';
  update bot_recovery_runs set status = 'restoring';
  if commit_bot_recovery(run_id, 'new-webhook') then raise exception 'foreign account accepted'; end if;

  update mtproto_accounts set tenant_id = '10000000-0000-0000-0000-000000000001';
  update bot_recovery_settings set enabled = false;
  update bot_recovery_runs set status = 'restoring';
  if commit_bot_recovery(run_id, 'new-webhook') then raise exception 'disabled recovery committed'; end if;

  update bot_recovery_settings set enabled = true;
  update bot_recovery_runs set status = 'restoring';
  if not commit_bot_recovery(run_id, 'new-webhook') then raise exception 'valid recovery failed'; end if;
  if (select telegram_token from bots) <> '9876543210:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' then raise exception 'token not replaced'; end if;
  if (select bot_username from bots) <> 'newbot' then raise exception 'username not replaced'; end if;
  if (select webhook_url from bots) <> 'new-webhook' then raise exception 'webhook not replaced'; end if;
  if (select status from bot_recovery_runs) <> 'completed' then raise exception 'run not completed'; end if;
  if (select new_token from bot_recovery_runs) is not null then raise exception 'staged token not cleared'; end if;
  if (select identity_token_hash from bot_recovery_settings) <> encode(digest('9876543210:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','sha256'),'hex') then raise exception 'backup not associated with replacement'; end if;
  if (select identity->>'username' from bot_recovery_settings) <> 'newbot' then raise exception 'backup username not updated'; end if;
  if (select identity->>'telegramId' from bot_recovery_settings) <> '9876543210' then raise exception 'backup telegram ID not updated'; end if;
  if (select history from leads) <> 'preserved history' then raise exception 'history changed'; end if;
  if not commit_bot_recovery(run_id, 'new-webhook') then raise exception 'commit is not idempotent'; end if;
end;
$$;
select 'PASS: migration, credential CAS, ownership, deactivation, account scope, history and privileges' as result;
