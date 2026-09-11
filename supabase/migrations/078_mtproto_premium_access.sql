-- Libera os recursos MTProto para o assinante premium, não só para o owner.
--
-- A 028 declarou "apenas o owner pode: conectar contas MTProto, criar campanhas
-- MTProto, marcar bots como login MTProto" e criou duas defesas. Só uma delas
-- funciona hoje, e é justamente a que barrava o premium:
--
--   1. TRIGGER `guard_mtproto_login_bot_flag` — bloqueio real e absoluto.
--      Nenhuma migration posterior o redefiniu. É o que impedia o premium de
--      ter um bot de login, que é a porta de entrada das contas MTProto (é ele
--      que roda o fluxo de telefone + teclado). Sem bot de login, o premium
--      via a página de Automações mas não conectava conta por bot.
--
--   2. POLICIES `owner_only_*` em mtproto_accounts / mtproto_campaigns — letra
--      morta. Policies do Postgres são PERMISSIVE por padrão e se combinam com
--      OR; a 062 recriou `tenant_own_accounts` / `tenant_own_campaigns` como
--      `for all using (tenant_id = auth.uid() or is_admin())`, que já autoriza
--      sozinha. Nenhuma policy do projeto é `as restrictive`, então as
--      `owner_only_*` nunca negaram nada desde a 062 — só faziam quem lê o
--      schema concluir que MTProto é exclusivo do owner.
--
-- Esta migration alinha as duas com a regra real da feature (owner OU premium,
-- a mesma de `canAccessAutomations` no painel) e remove a parte que só mentia.
-- Reexecutável.

-- 1. O trigger passa a aceitar owner OU premium.
create or replace function public.guard_mtproto_login_bot_flag()
returns trigger
language plpgsql
security definer
as $$
begin
  if (tg_op = 'INSERT' and coalesce(new.is_mtproto_login_bot, false) = true)
     or (tg_op = 'UPDATE' and new.is_mtproto_login_bot is distinct from old.is_mtproto_login_bot) then
    -- Owner (singleton da instância), assinante premium ou admin. Cada tenant
    -- tem o seu: o handler cria as contas com o tenant_id do próprio bot, então
    -- o bot de login de um cliente nunca alcança a conta de outro.
    if not (public.is_owner() or public.is_premium() or public.is_admin()) then
      raise exception 'only owner, premium or admin can set is_mtproto_login_bot';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_mtproto_login_bot_flag on public.bots;
create trigger trg_guard_mtproto_login_bot_flag
  before insert or update on public.bots
  for each row execute function public.guard_mtproto_login_bot_flag();

-- 2. Reafirma as policies por tenant ANTES de remover as `owner_only_*`, para
-- que a remoção não possa abrir buraco numa base onde a 062 não tenha rodado.
drop policy if exists "tenant_own_accounts" on public.mtproto_accounts;
create policy "tenant_own_accounts" on public.mtproto_accounts
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());

drop policy if exists "tenant_own_campaigns" on public.mtproto_campaigns;
create policy "tenant_own_campaigns" on public.mtproto_campaigns
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());

-- 3. Fora as policies que diziam "owner only" sem nunca negar nada.
drop policy if exists "owner_only_insert_mtproto_accounts" on public.mtproto_accounts;
drop policy if exists "owner_only_update_mtproto_accounts" on public.mtproto_accounts;
drop policy if exists "owner_only_delete_mtproto_accounts" on public.mtproto_accounts;
drop policy if exists "owner_only_insert_mtproto_campaigns" on public.mtproto_campaigns;
drop policy if exists "owner_only_update_mtproto_campaigns" on public.mtproto_campaigns;
drop policy if exists "owner_only_delete_mtproto_campaigns" on public.mtproto_campaigns;
