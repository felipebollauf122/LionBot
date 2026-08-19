-- Rastreamento de qual combinação (mídia/texto/preço) de um envio de
-- remarketing converteu melhor. Uma linha por EXECUÇÃO de flow de
-- remarketing pro lead (não por nó) — guarda as escolhas feitas nessa
-- execução, sejam elas randomizadas ou fixas (modo determinístico também
-- grava, com os valores fixos, pra manter o histórico contínuo se o flow
-- for alternado entre os dois modos depois).
--
-- Sem policy de INSERT/UPDATE/DELETE pro tenant: só o worker (service role)
-- grava essas linhas — mesmo precedente de public.remarketing_progress
-- (004_remarketing.sql), que também é somente-leitura pro tenant.
create table if not exists public.remarketing_variant_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  remarketing_flow_id uuid not null references public.remarketing_flows(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  text_variant_index int,
  bundle_id uuid references public.product_bundles(id) on delete set null,
  sent_at timestamptz not null default now()
);

alter table public.remarketing_variant_sends enable row level security;

drop policy if exists "Tenants can view own remarketing variant sends" on public.remarketing_variant_sends;
create policy "Tenants can view own remarketing variant sends" on public.remarketing_variant_sends
  for select using (
    exists (select 1 from public.bots b where b.id = bot_id and b.tenant_id = auth.uid())
  );

create index if not exists idx_remarketing_variant_sends_flow
  on public.remarketing_variant_sends (remarketing_flow_id, sent_at);

-- Atribuição direta: hoje a compra vinda de remarketing não referencia de
-- volta o flow/envio que a gerou (transactions.flow_id usa
-- lead.current_flow_id, que a execução de remarketing nunca seta —
-- persistPosition=false em FlowProcessor.executeFlow). Colunas nullable,
-- populadas só no caminho de remarketing.
alter table public.transactions
  add column if not exists remarketing_flow_id uuid references public.remarketing_flows(id) on delete set null,
  add column if not exists remarketing_send_id uuid references public.remarketing_variant_sends(id) on delete set null;
