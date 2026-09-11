-- Reexecutavel: `create ... if not exists` / `create or replace` em tudo.
-- A versao original abortava no primeiro `create table` quando ja aplicada,
-- sem deixar aplicar o resto — e nao havia como saber onde a execucao
-- anterior tinha parado. Rodar de novo agora converge para o estado correto.
-- Recovery state is service-only: includes staged tokens and BotFather checkpoints.
create table if not exists public.bot_recovery_settings (
  bot_id uuid primary key references public.bots(id) on delete cascade,
  enabled boolean not null default true,
  account_ids uuid[] not null default '{}',
  identity jsonb,
  identity_token_hash text,
  backed_up_at timestamptz
);
create table if not exists public.bot_recovery_runs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null,
  status text not null default 'queued' check (status in ('queued','creating','restoring','completed','needs_attention','cancelled')),
  account_id uuid references public.mtproto_accounts(id) on delete set null,
  attempts jsonb not null default '[]',
  pending_username text,
  pending_after_id bigint,
  new_token text,
  new_username text,
  retry_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, token_hash)
);
create index if not exists bot_recovery_pending on public.bot_recovery_runs(status, retry_at);
alter table public.bot_recovery_settings enable row level security;
alter table public.bot_recovery_runs enable row level security;
revoke all on public.bot_recovery_settings, public.bot_recovery_runs from anon, authenticated;
grant all on public.bot_recovery_settings, public.bot_recovery_runs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bot-identity', 'bot-identity', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Compare-and-swap in one transaction. History/flows/products keep the same bot_id.
-- A manual token update, deactivation or ownership transfer cancels the commit.
create or replace function public.commit_bot_recovery(p_run_id uuid, p_webhook_url text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare r public.bot_recovery_runs; n integer;
begin
  select * into r from public.bot_recovery_runs where id = p_run_id for update;
  if not found then return false; end if;
  if r.status = 'completed' then return true; end if;
  if r.status <> 'restoring' or r.new_token is null or r.new_username is null then return false; end if;
  update public.bots set telegram_token = r.new_token,
    bot_username = r.new_username, webhook_url = p_webhook_url
  where id = r.bot_id and tenant_id = r.tenant_id and is_active
    and encode(digest(telegram_token, 'sha256'), 'hex') = r.token_hash
    and exists (select 1 from public.bot_recovery_settings s where s.bot_id = r.bot_id and s.enabled)
    and exists (select 1 from public.mtproto_accounts a where a.id = r.account_id and a.tenant_id = r.tenant_id);
  get diagnostics n = row_count;
  if n <> 1 then
    update public.bot_recovery_runs set status = 'cancelled', error_code = 'bot_changed', updated_at = now() where id = r.id;
    return false;
  end if;
  -- The restored identity is also a backup for the new credential generation.
  -- A second deletion before the next scan must not lose this recovery source.
  update public.bot_recovery_settings set
    identity_token_hash = encode(digest(r.new_token, 'sha256'), 'hex'),
    identity = jsonb_set(jsonb_set(identity, '{username}', to_jsonb(r.new_username)),
      '{telegramId}', to_jsonb(split_part(r.new_token, ':', 1)::bigint)),
    backed_up_at = now()
  where bot_id = r.bot_id and identity is not null;
  update public.bot_recovery_runs set status = 'completed', new_token = null,
    pending_username = null, pending_after_id = null, error_code = null,
    retry_at = null, updated_at = now() where id = r.id;
  return true;
end;
$$;
revoke all on function public.commit_bot_recovery(uuid, text) from public, anon, authenticated;
grant execute on function public.commit_bot_recovery(uuid, text) to service_role;
