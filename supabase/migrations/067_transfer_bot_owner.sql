-- 067_transfer_bot_owner.sql
-- Transferência de posse de bot: move UM bot e tudo que pertence a ele
-- (leads, vendas, flows, produtos, conjuntos, tracking, remarketing, mensagens,
-- mídia) de um tenant pra outro — de uma vez só, numa transação.
--
-- POR QUE UMA FUNÇÃO NO BANCO, e não N updates pelo app:
--
--   1) ATOMICIDADE. São 13 tabelas. Se o 7º update falhar no meio, o bot fica
--      com as vendas num dono e os leads no outro — analytics, remarketing e
--      notificação de venda passam a discordar entre si, sem jeito fácil de
--      voltar atrás.
--
--   2) RLS. O app só tem o cliente anon + cookie (lib/supabase/server.ts), não
--      há service role no Next — então todo update passaria por RLS. E duas
--      tabelas filhas só têm policy de SELECT, sem UPDATE nenhum pra admin:
--      lead_messages (038) e remarketing_variant_sends (060). UPDATE barrado
--      por RLS no PostgREST não dá erro — volta "0 linhas". Ou seja: feito pelo
--      app, essas duas ficariam pra trás em silêncio e a tela diria que deu
--      tudo certo.
--
-- Segurança: só admin (public.is_admin(), de 007_admin_rls.sql). search_path
-- fixo pra a função não ser sequestrada por um schema plantado no caminho.

-- ── Pré-requisito: não carimbar updated_at durante a transferência ─────────
--
-- leads, flows, remarketing_configs e remarketing_flows têm o trigger
-- set_updated_at (001_initial_schema.sql:188-191, 004_remarketing.sql:55-58),
-- que grava now() em QUALQUER update. Trocar o dono do bot é um update nessas
-- 4 tabelas — sem tratar isso, todos os leads passariam a exibir
-- "última atividade: agora" na tela de CLIENTES
-- (lib/actions/client-actions.ts:135 usa lead.updated_at pra isso). Mentira
-- permanente: o dado real de quando o lead falou pela última vez some.
--
-- A saída é uma chave de transação. Com 'eaglebot.preserve_updated_at' ligada,
-- o trigger repassa o valor antigo em vez de carimbar. Sem a chave — ou seja,
-- em todo o resto do sistema — o comportamento é byte a byte o de antes:
-- current_setting(..., true) devolve NULL quando a chave nunca foi setada.
create or replace function public.update_updated_at()
returns trigger as $$
begin
  if coalesce(current_setting('eaglebot.preserve_updated_at', true), '') = 'on' then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.transfer_bot_owner(
  p_bot_id uuid,
  p_new_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_tenant uuid;
  v_username   text;
  v_login_bot  boolean;
  v_active     int;
  v_counts     jsonb := '{}'::jsonb;
  v_n          int;
begin
  -- ── Autorização ─────────────────────────────────────────────────────────
  if not public.is_admin() then
    raise exception 'apenas admin pode transferir a posse de um bot'
      using errcode = '42501';
  end if;

  -- ── Validações ──────────────────────────────────────────────────────────
  -- FOR UPDATE trava a linha do bot: duas transferências simultâneas do mesmo
  -- bot viram fila, não corrida.
  select tenant_id, bot_username, is_mtproto_login_bot
    into v_old_tenant, v_username, v_login_bot
    from public.bots
   where id = p_bot_id
     for update;

  if not found then
    raise exception 'bot % não encontrado', p_bot_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.tenants where id = p_new_tenant_id) then
    raise exception 'usuário de destino % não existe', p_new_tenant_id
      using errcode = 'P0002';
  end if;

  if v_old_tenant = p_new_tenant_id then
    return jsonb_build_object(
      'changed', false,
      'reason', 'already_owner',
      'bot_id', p_bot_id,
      'bot_username', v_username,
      'old_tenant_id', v_old_tenant,
      'new_tenant_id', p_new_tenant_id
    );
  end if;

  -- Bot de login MTProto é infraestrutura do owner da instância (028/027): quem
  -- receber esse bot passa a conseguir vincular contas MTProto ao PRÓPRIO
  -- tenant pelo Telegram. Exige desmarcar a flag antes — decisão consciente,
  -- não efeito colateral de uma transferência.
  if coalesce(v_login_bot, false) then
    raise exception 'bot @% é bot de login MTProto — desmarque essa opção antes de transferir', v_username
      using errcode = '55006';
  end if;

  -- Clonagem de bot que ainda pode rodar apontando pra esse bot. Qualquer
  -- status que não seja 'completed' é relançável: 'draft' vira 'exploring' por
  -- launchBotCloneJob, e 'paused'/'failed' por resumeBotCloneJob
  -- (app/dashboard/automations/botclones/actions.ts:171 e :206) — os três
  -- aparecem como "Lançar"/"Retomar"/"Tentar de novo" na tela de progresso.
  --
  -- Um job desses relançado DEPOIS da transferência abre a sessão MTProto de
  -- job.account_id (bot-clone-handler.ts) e grava flows/produtos no bot — que
  -- agora é de outra pessoa. Não dá pra resolver movendo o job junto: a conta
  -- MTProto é do dono antigo e fica com ele, então o job viraria uma linha
  -- partida entre dois tenants, com o dono novo apertando "Retomar" e dirigindo
  -- o Telegram pessoal do dono antigo. Por isso: barra, não move.
  select count(*) into v_active
    from public.bot_clone_jobs
   where dest_bot_id = p_bot_id
     and status <> 'completed';

  if v_active > 0 then
    raise exception 'bot @% tem % clonagem(ns) não finalizada(s) — conclua, apague ou espere terminar antes de transferir', v_username, v_active
      using errcode = '55006';
  end if;

  -- ── Move tudo que é do bot ──────────────────────────────────────────────
  -- Todas essas tabelas têm bot_id + tenant_id denormalizado. O bot_id não
  -- muda; só o dono. Filhas primeiro, o bot por último.

  -- `true` = local à transação: some sozinha no commit/rollback, e nenhuma
  -- outra sessão do banco enxerga essa chave.
  perform set_config('eaglebot.preserve_updated_at', 'on', true);

  update public.products set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('products', v_n);

  update public.product_bundles set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('product_bundles', v_n);

  update public.flows set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('flows', v_n);

  update public.leads set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('leads', v_n);

  update public.transactions set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('transactions', v_n);

  update public.tracking_events set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tracking_events', v_n);

  update public.remarketing_configs set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('remarketing_configs', v_n);

  update public.remarketing_flows set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('remarketing_flows', v_n);

  update public.remarketing_variant_sends set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('remarketing_variant_sends', v_n);

  update public.lead_messages set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('lead_messages', v_n);

  update public.media_assets set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('media_assets', v_n);

  -- bot_clone_jobs NÃO se move — de propósito. A linha guarda duas posses
  -- diferentes: tenant_id (quem mandou clonar) e account_id -> mtproto_accounts
  -- (a conta de Telegram PESSOAL que fez a exploração). A conta fica com o dono
  -- antigo, então mexer só no tenant_id partiria a linha entre dois tenants —
  -- e a RLS de bot_clone_jobs é tenant_id = auth.uid() (054:138), ou seja, o
  -- dono novo passaria a enxergar e operar um job amarrado ao Telegram do dono
  -- antigo. O que interessa do clone (o flow gerado) já viajou em public.flows.
  --
  -- Os jobs relançáveis já foram barrados lá em cima; os 'completed' que ficam
  -- pra trás não têm nenhuma ação na UI que reabra a conta.

  -- Sessões de login MTProto pendentes nesse bot: só existem se a flag
  -- is_mtproto_login_bot já esteve ligada. Barrado acima, mas pode haver
  -- resíduo de quando a flag estava ativa — vai junto pra não deixar linha
  -- órfã apontando pro tenant antigo.
  update public.mtproto_login_sessions set tenant_id = p_new_tenant_id where bot_id = p_bot_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mtproto_login_sessions', v_n);

  -- O bot por último: enquanto ele não muda, qualquer leitura concorrente
  -- ainda enxerga um estado coerente (dono antigo, filhas do dono antigo).
  update public.bots set tenant_id = p_new_tenant_id where id = p_bot_id;

  perform set_config('eaglebot.preserve_updated_at', 'off', true);

  -- Memória de atribuição por tenant (020_tenant_lead_identity.sql): é um
  -- cache "esse telegram_user_id veio de tal campanha". Copia só as linhas
  -- cuja atribuição NASCEU neste bot (first_bot_id) — o resto é de outros bots
  -- do dono antigo e não tem por que atravessar junto. `do nothing` porque a
  -- memória que o novo dono já tiver vale mais que a importada.
  insert into public.tenant_lead_identity (
    tenant_id, telegram_user_id, tid, fbclid,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    first_bot_id, last_bot_id, first_seen_at, last_updated_at
  )
  select
    p_new_tenant_id, tli.telegram_user_id, tli.tid, tli.fbclid,
    tli.utm_source, tli.utm_medium, tli.utm_campaign, tli.utm_content, tli.utm_term,
    tli.first_bot_id, tli.last_bot_id, tli.first_seen_at, tli.last_updated_at
  from public.tenant_lead_identity tli
  where tli.tenant_id = v_old_tenant
    and tli.first_bot_id = p_bot_id
  on conflict (tenant_id, telegram_user_id) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tenant_lead_identity_copied', v_n);

  -- NÃO viaja com o bot, de propósito:
  --   • traffic_filter_rules — as regras de allow/block são por TENANT e valem
  --     pra todos os bots do dono; copiar traria regra feita pra outro bot.
  --     O robô revisor do FB não é problema aqui: desde a 046 quem manda é a
  --     flag bots.tf_block_fb_crawler, que acompanha o bot (evaluateRules em
  --     lib/traffic-filter/match.ts:185 ignora as seeds antigas). O que o novo
  --     dono perde são as regras CUSTOM — a UI avisa.
  --   • push_subscriptions — são dispositivos do dono, não do bot. O novo dono
  --     passa a receber as vendas porque transactions.tenant_id mudou.
  --   • mtproto_accounts / automation_bots — infraestrutura da conta de quem
  --     clonou, não do bot.

  return jsonb_build_object(
    'changed', true,
    'bot_id', p_bot_id,
    'bot_username', v_username,
    'old_tenant_id', v_old_tenant,
    'new_tenant_id', p_new_tenant_id,
    'moved', v_counts
  );
end;
$$;

comment on function public.transfer_bot_owner(uuid, uuid) is
  'Admin-only: move um bot e todas as linhas filhas (leads, vendas, flows, produtos, tracking, remarketing, mensagens, mídia) para outro tenant, atomicamente. Retorna jsonb com a contagem por tabela.';

-- PostgREST expõe funções por padrão a quem tiver EXECUTE. Fecha pra anon:
-- só sessão autenticada chega na função, e lá dentro o is_admin() decide.
revoke execute on function public.transfer_bot_owner(uuid, uuid) from public;
revoke execute on function public.transfer_bot_owner(uuid, uuid) from anon;
grant  execute on function public.transfer_bot_owner(uuid, uuid) to authenticated;
