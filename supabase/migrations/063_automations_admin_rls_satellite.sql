-- Continuação da 062: bypass de admin nas tabelas SATÉLITE de Automações
-- (as que penduram em mtproto_accounts/mtproto_campaigns/clone_jobs/
-- bot_clone_jobs via account_id/campaign_id/job_id, não tenant_id direto).
-- Sem isso, abrir "Mensagens" ou "Ver conteúdo" na conta de outro usuário
-- (ou o relatório de pulados de um clone/botclone alheio) continua em
-- branco mesmo com a 062 aplicada, porque essas tabelas checam o dono via
-- subquery em mtproto_accounts/clone_jobs/bot_clone_jobs, sem a exceção.

-- MTPROTO AUTH SESSIONS
drop policy if exists "tenant_own_auth_sessions" on public.mtproto_auth_sessions;
create policy "tenant_own_auth_sessions" on public.mtproto_auth_sessions
  for all
  using (account_id in (select id from public.mtproto_accounts where tenant_id = auth.uid() or public.is_admin()))
  with check (account_id in (select id from public.mtproto_accounts where tenant_id = auth.uid() or public.is_admin()));

-- MTPROTO TARGETS (pendura em campaign_id)
drop policy if exists "tenant_own_targets" on public.mtproto_targets;
create policy "tenant_own_targets" on public.mtproto_targets
  for all
  using (campaign_id in (select id from public.mtproto_campaigns where tenant_id = auth.uid() or public.is_admin()))
  with check (campaign_id in (select id from public.mtproto_campaigns where tenant_id = auth.uid() or public.is_admin()));

-- MTPROTO DIALOGS (pendura em account_id) — usado por "Ver conteúdo"
drop policy if exists "tenant_own_mtproto_dialogs" on public.mtproto_dialogs;
create policy "tenant_own_mtproto_dialogs" on public.mtproto_dialogs
  for all
  using (account_id in (select id from public.mtproto_accounts where tenant_id = auth.uid() or public.is_admin()))
  with check (account_id in (select id from public.mtproto_accounts where tenant_id = auth.uid() or public.is_admin()));

-- MTPROTO INCOMING MESSAGES (pendura em account_id) — usado por "Mensagens"
drop policy if exists "tenants read own incoming msgs" on public.mtproto_incoming_messages;
create policy "tenants read own incoming msgs" on public.mtproto_incoming_messages
  for select
  using (account_id in (select id from public.mtproto_accounts where tenant_id = auth.uid() or public.is_admin()));

-- CLONE MESSAGE MAP (pendura em job_id → clone_jobs) — relatório de pulados
drop policy if exists "owner manages own clone_message_map" on public.clone_message_map;
create policy "owner manages own clone_message_map" on public.clone_message_map
  for all
  using (job_id in (select id from public.clone_jobs where tenant_id = auth.uid() or public.is_admin()))
  with check (job_id in (select id from public.clone_jobs where tenant_id = auth.uid() or public.is_admin()));

-- BOT CLONE NODES (pendura em job_id → bot_clone_jobs) — relatório de pulados
drop policy if exists "owner manages own bot_clone_nodes" on public.bot_clone_nodes;
create policy "owner manages own bot_clone_nodes" on public.bot_clone_nodes
  for all
  using (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid() or public.is_admin()))
  with check (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid() or public.is_admin()));

-- BOT CLONE REMARKETING MESSAGES (pendura em job_id → bot_clone_jobs)
drop policy if exists "owner manages own bot_clone_remarketing_messages" on public.bot_clone_remarketing_messages;
create policy "owner manages own bot_clone_remarketing_messages" on public.bot_clone_remarketing_messages
  for all
  using (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid() or public.is_admin()))
  with check (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid() or public.is_admin()));
