-- Clone de tópicos de fórum (supergrupo com Topics ligado). Espelha
-- clone_message_map (049_channel_clone.sql): mapa origem->destino, upsert
-- por (job_id, source_topic_id), RLS via subquery em clone_jobs.tenant_id.
--
-- source_is_forum segue o mesmo padrão reativo de mtproto_accounts.create_restricted
-- (051_clone_cross_account.sql): recalculado do zero em toda execução do
-- clone-handler, nunca é a fonte de verdade pra decisão de fluxo — só
-- alimenta o dashboard. status='skipped' está no check por consistência de
-- vocabulário com clone_message_map — a implementação atual nunca escreve
-- esse valor (só 'copied'/'failed').

alter table public.clone_jobs
  add column if not exists source_is_forum boolean not null default false;

create table if not exists public.clone_topic_map (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.clone_jobs(id) on delete cascade,
  source_topic_id bigint not null,
  dest_topic_id bigint,
  title text not null,
  status text not null check (status in ('copied', 'skipped', 'failed')),
  reason text,
  unique (job_id, source_topic_id)
);

create index if not exists idx_clone_topic_map_job_status
  on public.clone_topic_map(job_id, status);

alter table public.clone_topic_map enable row level security;

create policy "owner manages own clone_topic_map" on public.clone_topic_map
  for all
  using (job_id in (select id from public.clone_jobs where tenant_id = auth.uid()))
  with check (job_id in (select id from public.clone_jobs where tenant_id = auth.uid()));
