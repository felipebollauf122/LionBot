-- EagleBot: ajusta a retenção de tracking_events pra não apagar o contexto de clique.
--
-- A #015 apagava TUDO com mais de 7 dias — page_view incluído. Só que o
-- page_view é a única linha que guarda ttclid, ttp, fbp/fbc, click_time,
-- client_ip, user_agent, accept_language, referer e source_url: o
-- loadClickContext() (server/src/services/tracking-service.ts) busca
-- exatamente o page_view mais recente daquele tid pra montar o user_data
-- mandado pro CAPI do Facebook e do TikTok. Passados 7 dias do clique esse
-- page_view sumia, e daí em diante toda compra ia pro CAPI sem nenhum sinal
-- de match — EMQ despenca e a conversão não é atribuída ao anúncio.
--
-- Não é caso de borda: o remarketing do projeto não filtra idade do lead e
-- reengaja indefinidamente, então venda 2+ semanas depois do clique é rotina.
--
-- Escolha: manter o conceito de retenção da #015 (ela existe pra tabela não
-- crescer sem teto), mas com janela POR TIPO de evento em vez de janela única:
--   - page_view: 180 dias. Cobre com folga a janela de atribuição de clique
--     das duas redes (Facebook: até 28 dias de clique, cookie _fbc de 90 dias;
--     TikTok na mesma ordem de grandeza) e o horizonte real do remarketing.
--   - bot_start / view_offer / checkout / purchase: continuam em 7 dias. O
--     motivo original da #015 (auditoria curta do que já foi enviado, /start
--     atrasado, reprocessamento) segue valendo — e nenhum deles carrega
--     contexto de clique, então apagá-los não custa match.
--
-- Preferimos isso a simplesmente excluir page_view da limpeza: assim a tabela
-- continua tendo um teto. Hoje são ~27 mil linhas no total; mesmo com
-- page_view vivendo 180 dias o volume segue irrelevante pro Postgres.

create extension if not exists pg_cron with schema extensions;

-- Mesmo jobname da #015: derruba e recria (idempotente) em vez de criar um
-- segundo job — senão o comando antigo de 7 dias continuaria rodando junto e
-- apagando os page_view assim mesmo.
select cron.unschedule('tracking_events_retention')
where exists (select 1 from cron.job where jobname = 'tracking_events_retention');

select cron.schedule(
  'tracking_events_retention',
  '0 3 * * *',
  $$delete from public.tracking_events
      where created_at < now() - interval '7 days'
        and (event_type <> 'page_view' or created_at < now() - interval '180 days')$$
);
