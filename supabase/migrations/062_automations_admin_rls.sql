-- Admin RLS bypass pras tabelas de Automações (mtproto/clone), no mesmo
-- padrão do 007_admin_rls.sql (bots/leads/transactions/...). Sem isso, o
-- seletor de visão admin (Minha/Todos/Usuário) da página /dashboard/automations
-- filtra por outro tenant_id mas a RLS ainda bloqueia — resultado vazio.

-- MTPROTO ACCOUNTS
drop policy if exists "tenant_own_accounts" on public.mtproto_accounts;
create policy "tenant_own_accounts" on public.mtproto_accounts
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());

-- MTPROTO CAMPAIGNS
drop policy if exists "tenant_own_campaigns" on public.mtproto_campaigns;
create policy "tenant_own_campaigns" on public.mtproto_campaigns
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());

-- AUTOMATION BOTS (bot companheiro que publica os clones)
drop policy if exists "owner manages own automation_bots" on public.automation_bots;
create policy "owner manages own automation_bots" on public.automation_bots
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());

-- CLONE JOBS (clonagem de canais/grupos)
drop policy if exists "owner manages own clone_jobs" on public.clone_jobs;
create policy "owner manages own clone_jobs" on public.clone_jobs
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());

-- BOT CLONE JOBS (clonagem de fluxo de bot)
drop policy if exists "owner manages own bot_clone_jobs" on public.bot_clone_jobs;
create policy "owner manages own bot_clone_jobs" on public.bot_clone_jobs
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());
