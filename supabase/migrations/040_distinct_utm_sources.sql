-- DISTINCT de fontes (utm_source) no servidor — pro dropdown de filtro da aba
-- Análises não cortar fontes (antes pegava só os primeiros 2000 leads em ordem
-- indefinida e fatiava em 30). Retorna as fontes distintas do tenant ordenadas
-- por frequência (as mais usadas primeiro). RLS-safe: filtra pelo tenant logado.

create or replace function public.distinct_utm_sources(p_limit int default 50)
returns table(utm_source text)
language sql
stable
security invoker
as $$
  select l.utm_source
  from public.leads l
  where l.tenant_id = auth.uid()
    and l.utm_source is not null
    and l.utm_source <> ''
  group by l.utm_source
  order by count(*) desc
  limit p_limit;
$$;
