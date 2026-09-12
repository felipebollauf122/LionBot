-- Troca recurrence_minutes por recurrence_seconds para suportar repeticao por
-- segundo. Mesma manobra da 080 (que ja tinha trocado horas por minutos).
--
-- Minimo 5s, nao 1s: quem dispara o ciclo e o tick de recorrencia em
-- server/src/queue.ts, que roda a cada 5s. Aceitar 1s no banco seria mentir na
-- UI -- o ciclo sairia a cada 5s de qualquer jeito.
alter table public.mtproto_campaigns
  add column recurrence_seconds int check (recurrence_seconds is null or recurrence_seconds >= 5);

update public.mtproto_campaigns
  set recurrence_seconds = recurrence_minutes * 60
  where recurrence_minutes is not null;

drop index if exists public.idx_mtproto_campaigns_next_run;

alter table public.mtproto_campaigns
  drop column recurrence_minutes;

create index idx_mtproto_campaigns_next_run
  on public.mtproto_campaigns(next_run_at)
  where recurrence_seconds is not null;
