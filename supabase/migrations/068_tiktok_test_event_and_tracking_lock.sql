-- 068_tiktok_test_event_and_tracking_lock.sql

-- 1) tiktok_test_event_code por bot: substitui a env var global
--    TIKTOK_TEST_EVENT_CODE do server (removida em tiktok-events.ts nesta
--    mesma auditoria) — testar o pixel de 1 bot com a env var global desviava
--    SIMULTANEAMENTE a produção de TODOS os outros bots do mesmo processo
--    Express pra aba Test Events dos pixels deles. Agora cada bot guarda o
--    próprio Test Event Code (TikTok Events Manager → Test Events) e o botão
--    "Enviar evento de teste" do dashboard usa só esse valor, isolado por
--    bot, numa chamada dedicada que nunca passa pelo funil real.
alter table public.bots
  add column if not exists tiktok_test_event_code text;

-- 2) tracking_lock_at: mutex otimista pro bloco de tracking (Facebook/TikTok)
--    de completePurchase (purchase-completer.ts). Antes, o guard de dedup
--    fazia SELECT dos flags sent_to_facebook/sent_to_tiktok, disparava o
--    envio de rede (com retries, pode levar mais de 10s) e só regravava os
--    flags DEPOIS — sem lock nenhum nessa janela. completePurchase é chamado
--    de pelo menos 4 pontos que podem colidir na mesma transação (webhook de
--    pagamento, resposta de e-mail do lead, worker de timeout de 2h,
--    "Reenviar acesso" manual): duas chamadas próximas o bastante liam os
--    flags como false ANTES de qualquer uma escrever, e ambas disparavam
--    Purchase/CompletePayment real pra mesma compra.
--
--    Agora o guard reclama esse mutex atomicamente (UPDATE ... WHERE
--    tracking_lock_at IS NULL) antes de decidir o que enviar, e libera
--    (volta a NULL) assim que o envio termina — sucesso, falha, ou até no
--    caminho onde não havia nada pendente. Uma trava com mais de 2 minutos
--    também conta como livre (stale), pra um crash do processo no meio do
--    envio não travar retries futuros (inclusive "Reenviar acesso") pra
--    sempre.
alter table public.transactions
  add column if not exists tracking_lock_at timestamptz;
