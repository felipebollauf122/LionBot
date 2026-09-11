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
-- inerte: ela nunca recebe update nenhum. Por isso remover é seguro NO QUE
-- DIZ RESPEITO AO TELEGRAM — mas não no banco, e é aí que mora o perigo.
--
-- ⚠️ NÃO apaga nada. Muitas tabelas referenciam bots com `on delete cascade`
-- (leads, transactions, flows, products, media_assets, social_proof, …), então
-- apagar o bot errado leva junto lead e venda. Qual linha fica é decisão de
-- quem conhece os dados, não desta migration. Se houver duplicatas, ela PARA e
-- diz o que rodar — falhar alto é melhor que apagar sozinha ou fingir que
-- aplicou. Depois de limpar, rode de novo: é reexecutável.

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
      'Existem % grupos de bots duplicados (mesmo tenant_id + telegram_token). O indice unico nao pode ser criado antes da limpeza. Rode a consulta de diagnostico no comentario desta migration, escolha qual linha fica em cada grupo (a que tem leads/vendas), apague as outras e rode esta migration de novo.', grupos;
  end if;
end $$;

create unique index if not exists idx_bots_unique_token_per_tenant
  on public.bots (tenant_id, telegram_token);

-- ── Diagnóstico: quais são as duplicatas e o que cada linha carrega ──────────
-- Rode isto antes de apagar qualquer coisa. A linha com leads/vendas é a que
-- deve ficar; as zeradas costumam ser as sobras dos envios repetidos.
--
--   select b.id, b.bot_username, b.created_at, b.is_active,
--          (select count(*) from public.leads         l where l.bot_id = b.id) as leads,
--          (select count(*) from public.transactions  t where t.bot_id = b.id) as vendas,
--          (select count(*) from public.flows         f where f.bot_id = b.id) as flows,
--          (select count(*) from public.products      p where p.bot_id = b.id) as produtos
--     from public.bots b
--     join (
--       select tenant_id, telegram_token
--         from public.bots
--        group by tenant_id, telegram_token
--       having count(*) > 1
--     ) d on d.tenant_id = b.tenant_id and d.telegram_token = b.telegram_token
--    order by b.telegram_token, b.created_at;
--
-- Para apagar uma sobra, uma de cada vez e conferindo o id:
--   delete from public.bots where id = 'COLE-O-ID-AQUI';
