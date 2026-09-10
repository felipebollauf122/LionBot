-- Modo rascunho do clone: em vez de publicar no destino, o job grava o
-- conteúdo raspado como mensagens agendadas de uma campanha (074).
--
-- default 'live' mantém todo job existente com o comportamento de hoje.
-- dest_kind e dest_title continuam NOT NULL: no modo rascunho, dest_title
-- recebe o nome da campanha e dest_kind é derivado do dialog de origem como
-- sempre — inofensivo, porque nada no caminho draft os lê.

alter table public.clone_jobs
  add column if not exists mode text not null default 'live'
    check (mode in ('live','draft')),
  add column if not exists draft_campaign_id uuid
    references public.mtproto_scheduled_campaigns(id) on delete set null,
  add column if not exists ai_clean boolean not null default false,
  add column if not exists ai_rewrite boolean not null default false,
  add column if not exists ai_smart_delay boolean not null default false;

-- Fecha o laço deixado aberto na 074 (as duas tabelas já existem agora).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sched_campaigns_clone_job_fk'
  ) then
    alter table public.mtproto_scheduled_campaigns
      add constraint sched_campaigns_clone_job_fk
        foreign key (source_clone_job_id)
        references public.clone_jobs(id) on delete set null;
  end if;
end $$;

-- "Abrir rascunho" na tela do clone busca por esta coluna.
create index if not exists idx_clone_jobs_draft_campaign
  on public.clone_jobs(draft_campaign_id) where draft_campaign_id is not null;
