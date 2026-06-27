-- 046_traffic_filter_fb_crawler_flag.sql
-- Transforma o "bloquear crawler do FB" numa categoria liga/desliga própria,
-- igual às outras 3 (tf_block_spies/datacenter/adlibrary). Antes dependia de
-- existirem regras fb_crawler no banco (seed da migration 044); agora é uma
-- flag direta no bot, então a chave SEMPRE aparece na UI.
--
-- Os 3 user-agents da classe (facebookexternalhit, facebookcatalog,
-- meta-externalagent) são bloqueados juntos quando esta flag está ligada.
--
-- Default FALSE = crawler PERMITIDO (anúncio aprova). Bloquear é cloaking;
-- a UI avisa do risco de ban antes de ligar.

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS tf_block_fb_crawler boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bots.tf_block_fb_crawler IS
  'Filtro: bloqueia o robô revisor do FB (facebookexternalhit/facebookcatalog/meta-externalagent). CLOAKING — risco de reprovar anúncio/banir conta.';
