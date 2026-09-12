-- A 083 calculava o agregado antes de esperar outra transacao terminar de
-- atualizar a campanha. Um hot-add concorrente com um envio podia sobrescrever
-- sent_count com um snapshot antigo (0, embora a linha ja estivesse sent).
-- Serializa as recontagens ANTES de consultar os alvos: no READ COMMITTED,
-- o UPDATE seguinte recebe um snapshot novo, incluindo o commit esperado.
create or replace function public.mtproto_campaigns_recount(p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  -- NO KEY UPDATE e compativel com o KEY SHARE adquirido pela FK ao inserir
  -- um alvo. FOR UPDATE aqui causaria deadlock entre dois hot-adds. A ordem
  -- por id mantem uma ordem unica quando o statement afeta varias campanhas.
  perform c.id
  from public.mtproto_campaigns c
  where c.id = any(p_ids)
  order by c.id
  for no key update;

  update public.mtproto_campaigns c
  set total_targets = coalesce(s.total, 0),
      sent_count    = coalesce(s.sent, 0),
      failed_count  = coalesce(s.failed, 0),
      skipped_count = coalesce(s.skipped, 0)
  from unnest(p_ids) as ids(id)
  left join lateral (
    select count(*) filter (where t.status <> 'skipped') as total,
           count(*) filter (where t.status = 'sent')     as sent,
           count(*) filter (where t.status = 'failed')   as failed,
           count(*) filter (where t.status = 'skipped')  as skipped
    from public.mtproto_targets t
    where t.campaign_id = ids.id
  ) s on true
  where c.id = ids.id;
end;
$$;

-- Repara tambem as campanhas que ja sofreram a corrida da versao anterior.
select public.mtproto_campaigns_recount(array(select id from public.mtproto_campaigns));
