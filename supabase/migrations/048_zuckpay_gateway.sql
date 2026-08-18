-- 048_zuckpay_gateway.sql
-- ZuckPay como terceiro gateway (cada bot escolhe sigilopay, evpay ou zuckpay).
-- Segue o mesmo padrão da 018 (EvPay).

-- 1) Libera 'zuckpay' no CHECK de payment_gateway. A 018 criou um CHECK inline
--    sem nome → o Postgres o nomeia bots_payment_gateway_check. Dropamos e
--    recriamos incluindo 'zuckpay' (senão o INSERT/UPDATE com 'zuckpay' é rejeitado).
alter table public.bots
  drop constraint if exists bots_payment_gateway_check;
alter table public.bots
  add constraint bots_payment_gateway_check
  check (payment_gateway in ('sigilopay', 'evpay', 'zuckpay'));

-- 2) Credenciais ZuckPay. Basic auth = client_id:client_secret; o webhook é
--    assinado com HMAC-SHA256 (X-ZuckPay-Signature) usando o webhook_secret
--    que geramos por bot (mesmo padrão do evpay_webhook_secret).
alter table public.bots
  add column if not exists zuckpay_client_id text,
  add column if not exists zuckpay_client_secret text,
  add column if not exists zuckpay_webhook_secret text;

-- transactions.gateway é text livre (sem CHECK, ver 001) → guardar 'zuckpay'
-- não exige mudança. O índice idx_transactions_gateway_status_created (034) já
-- cobre o scan do poller por gateway='zuckpay'.
