-- Impede que o mesmo bot seja cadastrado duas vezes no mesmo tenant.
--
-- A tela de criar bot inseria sem nenhuma checagem, e `bots.telegram_token` só
-- tinha índice comum (012), nada de unicidade. Bastava um segundo envio —
-- clique duplo, Enter no campo, ou a pessoa achando que travou e tentando de
-- novo — para nascer outra linha idêntica. O painel passou a reaproveitar o bot
-- existente em vez de inserir, mas isso é uma leitura seguida de escrita: dois
-- envios simultâneos ainda passariam pelos dois lados da checagem. Esta é a
-- trava que fecha a corrida.
--
-- Um token só pode ter um webhook no Telegram, então a linha duplicada nasce
-- inerte: nunca recebe update nenhum, nunca acumula lead nem venda.
--
-- A limpeza abaixo remove SOMENTE essas sobras inertes, e nunca a mais antiga
-- do grupo. "Inerte" não é chute: para cada candidata, o bloco pergunta ao
-- catálogo do Postgres quem referencia `bots` e checa TODAS as tabelas, uma a
-- uma. Se qualquer uma tiver uma linha apontando para aquele bot — lead,
-- venda, flow, produto, mídia, prova social, identidade de lead, o que for —
-- a candidata é preservada. Perguntar ao catálogo em vez de listar as tabelas
-- aqui é proposital: uma tabela esquecida numa lista escrita à mão seria dado
-- apagado em silêncio, e tabela nova entra no projeto o tempo todo.
--
-- Se depois disso ainda sobrar grupo duplicado, são duas linhas COM dados — o
-- webhook trocou de bot em algum momento e o histórico se dividiu. Aí não há
-- resposta automática: a migration para e a escolha é de quem conhece os
-- dados. Reexecutável.

-- ── 1. Remove as sobras que não têm nada apontando para elas ─────────────────
do $$
declare
  sobra record;
  fk record;
  usada boolean;
  removidas integer := 0;
begin
  for sobra in
    select id from (
      select b.id,
             row_number() over (
               partition by b.tenant_id, b.telegram_token
               order by b.created_at, b.id
             ) as pos
        from public.bots b
        join (
          select tenant_id, telegram_token
            from public.bots
           group by tenant_id, telegram_token
          having count(*) > 1
        ) d on d.tenant_id = b.tenant_id and d.telegram_token = b.telegram_token
    ) x
    -- pos = 1 é a mais antiga do grupo: nunca entra na lista de candidatas.
    where x.pos > 1
  loop
    usada := false;

    for fk in
      select c.conrelid::regclass as tabela, a.attname as coluna
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f'
         and c.confrelid = 'public.bots'::regclass
         and array_length(c.conkey, 1) = 1
    loop
      execute format('select exists (select 1 from %s where %I = $1)', fk.tabela, fk.coluna)
        into usada
        using sobra.id;
      exit when usada;
    end loop;

    if not usada then
      delete from public.bots where id = sobra.id;
      removidas := removidas + 1;
    end if;
  end loop;

  raise notice 'Sobras vazias removidas: %', removidas;
end $$;

-- ── 2. Confere o que sobrou e só então cria a trava ──────────────────────────
-- Os dois num bloco só de propósito: separados, o `create index` ainda rodava
-- depois do raise e o operador levava DOIS erros, sendo o segundo o críptico
-- "could not create unique index ... is duplicated". Um erro, uma instrução.
do $$
declare grupos integer;
begin
  select count(*) into grupos from (
    select tenant_id, telegram_token
      from public.bots
     group by tenant_id, telegram_token
    having count(*) > 1
  ) d;

  if grupos > 0 then
    raise exception
      'Sobraram % grupos de bots duplicados em que MAIS DE UMA linha tem dados (lead, venda, flow, etc). A limpeza automatica nao apaga nenhuma delas de proposito. Rode a consulta de diagnostico no rodape desta migration para ver quanto cada linha carrega e decida qual fica.', grupos;
  end if;

  execute 'create unique index if not exists idx_bots_unique_token_per_tenant
             on public.bots (tenant_id, telegram_token)';
  raise notice 'Indice unico aplicado: duplicata de bot deixa de ser possivel.';
end $$;

-- ── Diagnóstico (só é preciso se o passo 2 parar) ────────────────────────────
--   select b.id, b.bot_username, b.created_at, b.is_active,
--          (select count(*) from public.leads        l where l.bot_id = b.id) as leads,
--          (select count(*) from public.transactions t where t.bot_id = b.id) as vendas,
--          (select count(*) from public.flows        f where f.bot_id = b.id) as flows,
--          (select count(*) from public.products     p where p.bot_id = b.id) as produtos
--     from public.bots b
--     join (
--       select tenant_id, telegram_token
--         from public.bots
--        group by tenant_id, telegram_token
--       having count(*) > 1
--     ) d on d.tenant_id = b.tenant_id and d.telegram_token = b.telegram_token
--    order by b.telegram_token, b.created_at;
--
-- Para apagar uma sobra com dados, uma de cada vez e conferindo o id:
--   delete from public.bots where id = 'COLE-O-ID-AQUI';
