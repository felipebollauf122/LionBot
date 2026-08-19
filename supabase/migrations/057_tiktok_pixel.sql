-- TikTok Events API (Conversions API server-side): pixel + access token por bot,
-- espelhando facebook_pixel_id/facebook_access_token. Sem conceito de pixel
-- reserva (isso é só do Facebook). sent_to_tiktok espelha sent_to_facebook em
-- tracking_events — mas ao contrário do Facebook (Purchase-only), o TikTok
-- dispara nos 4 eventos do funil (sem gate de FUNNEL_CAPI_ENABLED).

alter table public.bots
  add column if not exists tiktok_pixel_id text,
  add column if not exists tiktok_access_token text;

alter table public.tracking_events
  add column if not exists sent_to_tiktok boolean not null default false;
