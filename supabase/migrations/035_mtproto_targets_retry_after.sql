-- Onda 5 (#47): quando um target com conta pinned bate FLOOD_WAIT, em vez
-- de marcar falha permanente (perdendo o lead), marca retry_after com o
-- momento em que pode tentar de novo. O runner pula targets com retry_after
-- futuro e os reprocessa quando o tempo passa.
alter table public.mtproto_targets
  add column if not exists retry_after timestamptz;

create index if not exists idx_mtproto_targets_retry_after
  on public.mtproto_targets (campaign_id, retry_after)
  where retry_after is not null;
