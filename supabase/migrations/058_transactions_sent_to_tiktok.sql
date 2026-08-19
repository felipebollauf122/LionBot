-- transactions.sent_to_tiktok — espelha transactions.sent_to_facebook (#034),
-- mas pro guard de dedup do CompletePayment do TikTok em purchase-completer.
-- Sem essa coluna o guard de dedup só enxergava sent_to_facebook, então:
--   - bot com Facebook configurado + TikTok falhando: o guard travava no
--     sucesso do Facebook e todo retry (inclusive "Reenviar acesso" no
--     painel) pulava o TikTok pra sempre, sem caminho de recuperação;
--   - bot só com TikTok (sem Facebook): sent_to_facebook nunca vira true,
--     então o guard nunca trava e todo retry redispara o mesmo
--     CompletePayment (mesmo event_id), dependendo só do dedup do lado
--     do TikTok em vez do guard da aplicação.
alter table public.transactions
  add column if not exists sent_to_tiktok boolean not null default false;
