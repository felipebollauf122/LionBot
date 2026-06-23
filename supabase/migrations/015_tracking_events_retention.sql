-- EagleBot: retencao de tracking_events.
-- Apaga eventos com mais de 7 dias via pg_cron (roda 1x por dia as 03:00 UTC).
-- Mantemos 7 dias pra cobrir: page_view -> /start atrasado, reprocessamentos,
-- auditoria curta de purchase/checkout ja enviados.

create extension if not exists pg_cron with schema extensions;

-- remove job antigo se ja existir (idempotencia)
select cron.unschedule('tracking_events_retention')
where exists (select 1 from cron.job where jobname = 'tracking_events_retention');

select cron.schedule(
  'tracking_events_retention',
  '0 3 * * *',
  $$delete from public.tracking_events where created_at < now() - interval '7 days'$$
);
