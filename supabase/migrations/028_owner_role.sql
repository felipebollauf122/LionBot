-- Coluna is_owner: nível acima de admin. Apenas o owner pode:
--   - conectar contas MTProto
--   - criar campanhas MTProto
--   - marcar bots como 'login MTProto'
-- Single-tenant intent: na prática só existe 1 owner por instância.
alter table public.tenants
  add column if not exists is_owner boolean not null default false;

-- Garante no máximo um owner via unique partial index
create unique index if not exists idx_tenants_single_owner
  on public.tenants((true))
  where is_owner = true;

-- Marca o dono pelo email (única instância). Idempotente.
-- ⚠️ Se o email mudar, refazer esse update.
update public.tenants
   set is_owner = true
 where email = 'thiagovlourenco6@gmail.com';

-- Helper SQL function pra checks de RLS / actions
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(
    (select is_owner from public.tenants where id = auth.uid()),
    false
  );
$$;

-- RLS: só owner pode marcar/desmarcar is_mtproto_login_bot.
-- Cria um trigger que bloqueia o set dessa coluna por não-owners.
create or replace function public.guard_mtproto_login_bot_flag()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Só checa se a flag está sendo alterada / inserida como true
  if (tg_op = 'INSERT' and coalesce(new.is_mtproto_login_bot, false) = true)
     or (tg_op = 'UPDATE' and new.is_mtproto_login_bot is distinct from old.is_mtproto_login_bot) then
    if not public.is_owner() then
      raise exception 'only owner can set is_mtproto_login_bot';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_mtproto_login_bot_flag on public.bots;
create trigger trg_guard_mtproto_login_bot_flag
  before insert or update on public.bots
  for each row execute function public.guard_mtproto_login_bot_flag();

-- RLS: só owner pode inserir/modificar mtproto_accounts e mtproto_campaigns.
-- (Tabelas já têm tenant_id, mas garantimos via policy explícita.)
drop policy if exists "owner_only_insert_mtproto_accounts" on public.mtproto_accounts;
create policy "owner_only_insert_mtproto_accounts" on public.mtproto_accounts
  for insert
  with check (public.is_owner() and tenant_id = auth.uid());

drop policy if exists "owner_only_update_mtproto_accounts" on public.mtproto_accounts;
create policy "owner_only_update_mtproto_accounts" on public.mtproto_accounts
  for update
  using (public.is_owner() and tenant_id = auth.uid());

drop policy if exists "owner_only_delete_mtproto_accounts" on public.mtproto_accounts;
create policy "owner_only_delete_mtproto_accounts" on public.mtproto_accounts
  for delete
  using (public.is_owner() and tenant_id = auth.uid());

drop policy if exists "owner_only_insert_mtproto_campaigns" on public.mtproto_campaigns;
create policy "owner_only_insert_mtproto_campaigns" on public.mtproto_campaigns
  for insert
  with check (public.is_owner() and tenant_id = auth.uid());

drop policy if exists "owner_only_update_mtproto_campaigns" on public.mtproto_campaigns;
create policy "owner_only_update_mtproto_campaigns" on public.mtproto_campaigns
  for update
  using (public.is_owner() and tenant_id = auth.uid());

drop policy if exists "owner_only_delete_mtproto_campaigns" on public.mtproto_campaigns;
create policy "owner_only_delete_mtproto_campaigns" on public.mtproto_campaigns
  for delete
  using (public.is_owner() and tenant_id = auth.uid());
