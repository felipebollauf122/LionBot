-- Reformulação dos channel_templates: campos pra permissões + foto + flag
-- de auto-recriação no ban. E nova tabela channel_instances pra rastrear
-- canais criados a partir do template (substitui o uso anterior de
-- channel_monitors como rastreio).

alter table public.channel_templates
  add column if not exists profile_photo_url text,
  add column if not exists enable_reactions boolean not null default true,
  add column if not exists protect_content boolean not null default false,
  add column if not exists auto_recreate_on_ban boolean not null default false;

-- Canais criados a partir de templates. Cada linha = 1 canal criado.
-- Quando auto_recreate_on_ban está true E o canal/conta cai, o poller
-- automaticamente cria outra instância (mesma template) em outra conta.
create table if not exists public.channel_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.channel_templates(id) on delete cascade,
  account_id uuid not null references public.mtproto_accounts(id) on delete cascade,

  -- Canal criado
  channel_id text not null,
  access_hash text not null,
  invite_link text,
  title text not null,

  -- Estado
  status text not null default 'active'
    check (status in ('active','dead','replaced')),
  last_checked_at timestamptz,
  last_check_error text,
  detected_dead_at timestamptz,

  -- Se foi recriado, aponta pra próxima instância
  recreated_as_instance_id uuid references public.channel_instances(id) on delete set null,
  recreated_at timestamptz,
  recreation_error text,

  created_at timestamptz not null default now()
);

create index if not exists idx_channel_instances_tenant on public.channel_instances(tenant_id);
create index if not exists idx_channel_instances_active on public.channel_instances(status) where status = 'active';

alter table public.channel_instances enable row level security;
create policy "owner manages own channel_instances" on public.channel_instances
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
