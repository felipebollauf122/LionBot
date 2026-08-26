-- 070_multi_gateway.sql
-- Múltiplos gateways ativos por bot.
--
-- Até aqui `payment_gateway` era O gateway do bot (um só). Agora ele passa a
-- ser o gateway PADRÃO — usado quando o nó de pagamento no fluxo não escolhe
-- nenhum — e `enabled_gateways` lista todos os que o bot pode usar. Isso
-- permite, por exemplo, Poseidon (PIX) e NOWPayments (cripto) ativos ao mesmo
-- tempo, com o lead escolhendo o método dentro do fluxo.

alter table public.bots
  add column if not exists enabled_gateways text[];

-- Backfill: todo bot existente fica com exatamente o gateway que já usava.
-- Sem isso, um bot antigo (coluna nula) dependeria só do fallback em código —
-- que existe (getEnabledGateways cai em [payment_gateway]), mas deixar o dado
-- explícito no banco evita divergência entre o que a UI mostra e o que a
-- engine faz.
update public.bots
  set enabled_gateways = array[coalesce(payment_gateway, 'sigilopay')]
  where enabled_gateways is null;

-- payment_gateway continua com o CHECK da 069 (sigilopay/evpay/zuckpay/
-- nowpayments) — só muda de significado, não de domínio. enabled_gateways
-- fica sem CHECK de elementos (text[] não aceita o mesmo formato de
-- constraint); a validação de valores acontece no server action e o
-- resolveGatewayKind ignora qualquer valor desconhecido em runtime.
