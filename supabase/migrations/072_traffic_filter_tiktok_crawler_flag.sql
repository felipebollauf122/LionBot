-- 072_traffic_filter_tiktok_crawler_flag.sql
-- Paridade do filtro de tráfego com o TikTok: chave liga/desliga própria pro
-- robô da ByteDance/TikTok, igual à tf_block_fb_crawler (migration 046).
--
-- Antes disso o revisor do TikTok não tinha tratamento nenhum: ele rasteja a
-- landing SEM ttclid, caía no tf_block_spies e via a landing de venda em vez
-- da página real do bot. Isso é cloaking involuntário — anúncio reprovado sem
-- o dono ter ligado nada.
--
-- Default FALSE = robô PERMITIDO (anúncio aprova), mesma escolha do Facebook.
-- Ligar é cloaking; a UI confirma o risco de ban antes.

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS tf_block_tiktok_crawler boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bots.tf_block_tiktok_crawler IS
  'Filtro: bloqueia o robô da ByteDance/TikTok (Bytespider/TikTokSpider/TikTokBot). CLOAKING — risco de reprovar anúncio/banir conta.';
