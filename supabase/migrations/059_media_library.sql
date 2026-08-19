-- Biblioteca de mídia: assets (imagem/vídeo) que o tenant cadastra uma vez e
-- reutiliza em vários nós/flows — hoje cada nó image/video guarda uma única
-- URL solta em flow_data, sem lugar pra organizar/reaproveitar. Espelha o
-- padrão de public.products (001_initial_schema.sql): RLS só por tenant_id,
-- CRUD liberado (não é recurso premium — só a randomização que consome essa
-- biblioteca é gated, ver lib/actions/automations-access-actions.ts).

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  url text not null,
  kind text not null check (kind in ('image', 'video')),
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.media_assets enable row level security;

drop policy if exists "Tenants can manage own media assets" on public.media_assets;
create policy "Tenants can manage own media assets" on public.media_assets
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());

create index if not exists idx_media_assets_bot on public.media_assets (bot_id, is_active);
