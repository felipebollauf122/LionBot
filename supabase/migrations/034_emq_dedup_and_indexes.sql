-- Onda 1 (#6): dedup de Purchase no Facebook — marca quando a transação
-- já teve o evento Purchase enviado pro CAPI, evitando duplicata (que
-- derruba EMQ).
alter table public.transactions
  add column if not exists sent_to_facebook boolean not null default false;

-- Onda 3 (#32): índices pra hot paths.
-- transactions por (lead_id, status) — usado em checkAudience do remarketing
-- e em lookups de transação por lead.
create index if not exists idx_transactions_lead_status
  on public.transactions (lead_id, status);

-- transactions por (gateway, status, created_at) — usado nos pollers de
-- pagamento (evpay/poseidon) que varrem pending por gateway.
create index if not exists idx_transactions_gateway_status_created
  on public.transactions (gateway, status, created_at);

-- message_delete_queue por (status, delete_at) — usado no poller de deleção
-- de mensagens do black flow.
create index if not exists idx_message_delete_queue_status_delete_at
  on public.message_delete_queue (status, delete_at);
