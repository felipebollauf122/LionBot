-- 069_nowpayments_gateway.sql
-- NOWPayments como quarto gateway (cripto). Mesmo padrão da 048 (ZuckPay).

-- 1) Libera 'nowpayments' no CHECK de payment_gateway.
alter table public.bots
  drop constraint if exists bots_payment_gateway_check;
alter table public.bots
  add constraint bots_payment_gateway_check
  check (payment_gateway in ('sigilopay', 'evpay', 'zuckpay', 'nowpayments'));

-- 2) Credenciais NOWPayments. api_key vai no header x-api-key de toda
--    chamada; ipn_secret_key NUNCA é enviado, só usado localmente pra
--    calcular o HMAC-SHA512 do IPN (assinatura sobre o JSON com chaves
--    ordenadas, não sobre o buffer bruto — esquema diferente do EvPay/
--    ZuckPay). pay_currency é a moeda em que o bot recebe (ex: usdttrc20);
--    default USDT-TRC20 por ter fee baixa e mínimo compatível com tickets
--    pequenos em R$.
alter table public.bots
  add column if not exists nowpayments_api_key text,
  add column if not exists nowpayments_ipn_secret_key text,
  add column if not exists nowpayments_pay_currency text default 'usdttrc20';

-- transactions.gateway é text livre (sem CHECK, ver 001) → guardar
-- 'nowpayments' não exige mudança. O índice idx_transactions_gateway_status_created
-- (034) já cobre o scan do poller por gateway='nowpayments'.
