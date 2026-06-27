-- 045_traffic_filter_categories.sql
-- Transforma o "default por sinal" (antes fixo no código de match.ts) em
-- categorias liga/desliga por bot. A UI mostra chaves simples em português
-- em vez do formulário técnico de regra (IP/ASN/User-Agent na mão).
--
-- Todas começam LIGADAS = mantém o comportamento atual (espião/VPN/Ad Library
-- são bloqueados por padrão). O usuário pode desligar cada categoria.

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS tf_block_spies      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tf_block_datacenter boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tf_block_adlibrary  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.bots.tf_block_spies      IS 'Filtro: bloqueia humano sem fbclid (espião). Default por sinal.';
COMMENT ON COLUMN public.bots.tf_block_datacenter IS 'Filtro: bloqueia IP de datacenter/VPN/proxy.';
COMMENT ON COLUMN public.bots.tf_block_adlibrary  IS 'Filtro: bloqueia quem vem da Ad Library do Facebook.';
