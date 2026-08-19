-- Índices do hot path que faltavam — causa raiz da lentidão pra enviar
-- mensagem e pra gerar PIX.
--
-- 1) leads (bot_id, telegram_user_id)
--    findOrCreateLead (lead-service.ts) roda essa query em TODA mensagem e
--    TODO clique de botão. A tabela só tinha a PK (id) e as FKs — nenhum
--    índice cobria esse par. Resultado: sequential scan da tabela inteira
--    de leads a cada update recebido do Telegram. O custo cresce linear
--    com a base de leads, que é exatamente o sintoma relatado ("foi
--    ficando lento").
--
-- 2) transactions (external_id)
--    O webhook de pagamento (webhook/payment.ts), o worker de
--    payment-timeout (queue.ts) e os 3 pollers de gateway buscam a
--    transação por external_id. Sem índice, cada confirmação de PIX
--    fazia full scan de transactions — que só cresce, nunca é limpa.
--
-- Índices parciais/compostos escolhidos pra casar exatamente com o
-- predicado usado no código (leading column = coluna mais seletiva do
-- filtro de igualdade).

create index if not exists idx_leads_bot_telegram_user
  on public.leads (bot_id, telegram_user_id);

create index if not exists idx_transactions_external_id
  on public.transactions (external_id);
