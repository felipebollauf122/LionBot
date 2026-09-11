-- Troca recurrence_hours por recurrence_minutes para suportar repetiA AA Ao por minuto
alter table public.mtproto_campaigns
  add column recurrence_minutes int check (recurrence_minutes is null or recurrence_minutes >= 1);

update public.mtproto_campaigns
  set recurrence_minutes = recurrence_hours * 60
  where recurrence_hours is not null;

drop index if exists public.idx_mtproto_campaigns_next_run;

alter table public.mtproto_campaigns
  drop column recurrence_hours;

create index idx_mtproto_campaigns_next_run
  on public.mtproto_campaigns(next_run_at)
  where recurrence_minutes is not null;

