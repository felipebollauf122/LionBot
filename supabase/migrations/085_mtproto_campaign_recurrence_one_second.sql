-- Permite recorrencia definida somente em segundos, a partir de 1s.
-- O poller de campanhas acompanha este piso com tick a cada segundo.
alter table public.mtproto_campaigns
  drop constraint if exists mtproto_campaigns_recurrence_seconds_check;

alter table public.mtproto_campaigns
  add constraint mtproto_campaigns_recurrence_seconds_check
  check (recurrence_seconds is null or recurrence_seconds >= 1);
