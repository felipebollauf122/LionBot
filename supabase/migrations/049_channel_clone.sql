-- Bot companheiro do tenant, criado no BotFather pelo owner.
create table if not exists public.automation_bots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null,
  bot_user_id text not null,
  username text not null,
  session_string text,                       -- sessão MTProto do bot (lazy, no 1º uso)
  status text not null default 'active',     -- 'active' | 'invalid'
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)                          -- um bot por tenant no MVP
);

create table if not exists public.clone_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.mtproto_accounts(id) on delete cascade,

  -- origem (snapshot: dialog pode sumir no próximo sync)
  source_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  source_peer_id text not null,
  source_peer_type text not null check (source_peer_type in ('channel', 'chat')),
  source_peer_access_hash text,
  source_title text,

  -- destino. dest_kind deriva de mtproto_dialogs.kind no momento da criação:
  --   channel_owner | channel_subscriber      -> 'broadcast'
  --   group_admin   | group_member            -> 'megagroup'
  -- (supergrupo e canal são ambos peer_type='channel'; só o kind os distingue)
  dest_kind text not null check (dest_kind in ('broadcast', 'megagroup')),
  dest_title text not null,
  dest_channel_id text,
  dest_access_hash text,
  dest_invite_link text,

  -- configuração
  message_limit int check (message_limit is null or message_limit between 1 and 50000),
  strategy text not null default 'auto'
    check (strategy in ('auto', 'batch', 'download')),
  effective_strategy text
    check (effective_strategy in ('batch', 'download')),
  copy_identity boolean not null default true,
  copy_replies boolean not null default false,
  copy_pins boolean not null default false,
  copy_buttons boolean not null default false,
  copy_polls boolean not null default false,
  throttle_ms int not null default 3000,

  -- progresso
  status text not null default 'draft'
    check (status in ('draft','running','paused','waiting_flood','completed','failed')),
  cursor_source_msg_id bigint not null default 0,
  total_seen int not null default 0,
  copied_count int not null default 0,
  skipped_count int not null default 0,
  failed_count int not null default 0,
  resume_after timestamptz,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Mapa origem→destino. Paga três contas: remapear respostas, replicar pins
-- no final (o id do destino só existe depois do envio) e gerar o relatório.
create table if not exists public.clone_message_map (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.clone_jobs(id) on delete cascade,
  source_msg_id bigint not null,
  dest_msg_id bigint,
  grouped_id text,
  status text not null check (status in ('copied', 'skipped', 'failed')),
  reason text,
  unique (job_id, source_msg_id)
);

create index if not exists idx_clone_jobs_tenant_status
  on public.clone_jobs(tenant_id, status);
create index if not exists idx_clone_map_job_status
  on public.clone_message_map(job_id, status);

alter table public.automation_bots enable row level security;
alter table public.clone_jobs enable row level security;
alter table public.clone_message_map enable row level security;

create policy "owner manages own automation_bots" on public.automation_bots
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "owner manages own clone_jobs" on public.clone_jobs
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "owner manages own clone_message_map" on public.clone_message_map
  for all
  using (job_id in (select id from public.clone_jobs where tenant_id = auth.uid()))
  with check (job_id in (select id from public.clone_jobs where tenant_id = auth.uid()));
