-- Clona o fluxo de um bot terceiro pra dentro do EagleBot: /start automático
-- + clique em cada botão descoberto (BFS), reconstruindo um flow nativo.
-- Espelha o ciclo de vida de clone_jobs (049_channel_clone.sql,
-- 050_clone_resume_hardening.sql), adaptado pra árvore + janela de escuta.

create table if not exists public.bot_clone_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.mtproto_accounts(id) on delete cascade,
  dest_bot_id uuid not null references public.bots(id) on delete cascade,

  target_bot_username text not null,
  target_bot_peer_id text,
  target_bot_access_hash text,

  status text not null default 'draft'
    check (status in ('draft','exploring','waiting_flood','listening_remarketing',
                       'building_flow','completed','failed','paused')),

  max_depth int not null default 40,
  max_nodes int not null default 500,
  click_throttle_ms int not null default 3000,

  nodes_discovered int not null default 0,
  nodes_skipped int not null default 0,
  messages_captured int not null default 0,
  -- Scanner pós-clique (defesa em profundidade, não disjuntor — decisão do
  -- usuário: sinaliza e segue, não pausa). Agregado aqui pra alerta visível
  -- no dashboard sem precisar contar linhas de bot_clone_nodes.
  suspected_payment_hit boolean not null default false,

  explore_started_at timestamptz,
  explore_completed_at timestamptz,

  remarketing_deadline timestamptz,
  remarketing_cursor_msg_id bigint not null default 0,
  remarketing_next_poll_at timestamptz,
  remarketing_messages_captured int not null default 0,

  dest_flow_id uuid references public.flows(id) on delete set null,
  dest_remarketing_config_id uuid references public.remarketing_configs(id) on delete set null,

  resume_after timestamptz,
  processing_started_at timestamptz,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Trava de concorrência: duas explorações simultâneas na MESMA conta contra
-- o MESMO bot-alvo colidem no estado de carrinho/pedido que o bot-alvo
-- mantém por usuário — um clique avaliado como seguro pelo guard pode, na
-- hora que a RPC chega, cair num estado que a OUTRA exploração mudou.
create unique index if not exists uq_bot_clone_jobs_active_target
  on public.bot_clone_jobs(account_id, target_bot_username)
  where status not in ('completed', 'failed');

-- Um "turno" = tudo que o bot-alvo mandou em resposta a UMA ação (/start ou
-- um clique), possivelmente várias mensagens (texto + foto + botões).
create table if not exists public.bot_clone_nodes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bot_clone_jobs(id) on delete cascade,

  parent_node_id uuid references public.bot_clone_nodes(id) on delete set null,
  triggered_by_button_id text,
  depth int not null,

  fingerprint text not null,
  duplicate_of_node_id uuid references public.bot_clone_nodes(id) on delete set null,

  messages jsonb not null default '[]',
  -- cada item: { seq, text, entities, media_kind, media_public_url,
  --   buttons:[{id,kind,label,url,skip,skip_reason,payment_domain_match}] }

  status text not null
    check (status in ('explored', 'skipped_payment_risk', 'skipped_2fa', 'skipped_unsupported_button',
                       'skipped_depth_limit', 'skipped_node_cap', 'skipped_error', 'duplicate')),
  skip_reason text,
  -- Scanner pós-clique: flag por nó (não só agregado no job), já que a
  -- exploração continua depois de uma suspeita — cada ocorrência precisa
  -- ficar individualmente visível na revisão.
  payment_confirmation_suspected boolean not null default false,

  mapped_flow_node_id text,
  captured_at timestamptz not null default now()
);

-- Índice parcial: só exige unicidade de fingerprint entre linhas que NÃO são
-- 'duplicate' — o próprio algoritmo de loop insere uma 2ª linha 'duplicate'
-- com o MESMO fingerprint da original toda vez que detecta um ciclo
-- (praticamente garantido em qualquer bot com botão "Voltar"); uma
-- constraint simples travaria isso na primeira ocorrência.
create unique index if not exists uq_bot_clone_nodes_fingerprint
  on public.bot_clone_nodes(job_id, fingerprint)
  where status <> 'duplicate';

-- Idempotência de resume: antes de clicar um botão, confere se já existe
-- linha filha pra esse (job_id, parent_node_id, triggered_by_button_id) —
-- se sim, reusa em vez de clicar de novo (protege contra crash/restart
-- durante a exploração re-clicando algo já clicado).
create unique index if not exists uq_bot_clone_nodes_parent_button
  on public.bot_clone_nodes(job_id, parent_node_id, triggered_by_button_id)
  where triggered_by_button_id is not null;

-- Capturado na janela passiva de 24h pós-exploração.
create table if not exists public.bot_clone_remarketing_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bot_clone_jobs(id) on delete cascade,
  first_seq_msg_id bigint not null,   -- chave natural, dedup contra duplicata em crash/retry
  seconds_after_explore_end int not null,
  messages jsonb not null default '[]',
  mapped_remarketing_flow_id uuid,
  captured_at timestamptz not null default now(),
  unique (job_id, first_seq_msg_id)
);

create index if not exists idx_bot_clone_jobs_tenant_status
  on public.bot_clone_jobs(tenant_id, status);
create index if not exists idx_bot_clone_jobs_processing
  on public.bot_clone_jobs(processing_started_at) where processing_started_at is not null;
create index if not exists idx_bot_clone_jobs_remarketing_poll
  on public.bot_clone_jobs(remarketing_next_poll_at) where status = 'listening_remarketing';
create index if not exists idx_bot_clone_nodes_job
  on public.bot_clone_nodes(job_id);
create index if not exists idx_bot_clone_remarketing_job
  on public.bot_clone_remarketing_messages(job_id);

alter table public.bot_clone_jobs enable row level security;
alter table public.bot_clone_nodes enable row level security;
alter table public.bot_clone_remarketing_messages enable row level security;

create policy "owner manages own bot_clone_jobs" on public.bot_clone_jobs
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "owner manages own bot_clone_nodes" on public.bot_clone_nodes
  for all
  using (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid()))
  with check (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid()));
create policy "owner manages own bot_clone_remarketing_messages" on public.bot_clone_remarketing_messages
  for all
  using (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid()))
  with check (job_id in (select id from public.bot_clone_jobs where tenant_id = auth.uid()));
