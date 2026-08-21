-- Corrige race de "last write wins" em leads.state: hoje todo writer
-- (remarketing-worker, webhook do Telegram, webhook de pagamento,
-- purchase-completer) monta `{ ...lead.state, ...delta }` num objeto em
-- memória e reescreve a coluna inteira via `update({ state })`. Se dois
-- writers correm em paralelo pro mesmo lead, quem terminar de escrever por
-- último apaga silenciosamente o delta do outro — mesmo que o outro tenha
-- sido aplicado DEPOIS no relógio de parede. Isso é especialmente grave no
-- remarketing-worker, que carrega TODOS os leads do bot numa única query em
-- bloco (remarketing-worker.ts:103-107) e processa sequencialmente com
-- awaits reais (Telegram + DB, e sleep inline em delay node) — um lead no
-- fim do array pode ter seu snapshot de `state` obsoleto por dezenas de
-- segundos a minutos antes do write acontecer.
--
-- merge_lead_state aplica só o DELTA (patch) sobre o state ATUAL do banco,
-- atomicamente dentro do UPDATE (sob lock de linha do Postgres) — não
-- importa quão velho seja o snapshot em memória do caller, o merge sempre
-- parte do valor mais recente já persistido, então nenhum writer consegue
-- mais pisar no delta de outro.
--
-- Convenção JSON Merge Patch (RFC 7396): uma chave com valor `null` no
-- patch REMOVE a chave do state, em vez de gravar `null` literal —
-- substitui os `delete state.foo` que o código fazia em memória antes de
-- chamar updateState com o objeto já pronto.
create or replace function public.merge_lead_state(p_lead_id uuid, p_patch jsonb)
returns jsonb
language sql
volatile
security invoker
as $$
  update public.leads
  set state = (
    coalesce(state, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
  ) - (
    select coalesce(array_agg(key), array[]::text[])
    from jsonb_each(coalesce(p_patch, '{}'::jsonb))
    where value = 'null'::jsonb
  )
  where id = p_lead_id
  returning state;
$$;

-- Mesma correção para o combo posição+state usado pelo delay node com
-- persistPosition=true (flow-processor.ts, branch `isDelayPersist`).
-- current_flow_id/current_node_id continuam sendo o valor literal do
-- caller — essas colunas já eram seguras (só persistPosition=true escreve
-- nelas, remarketing nunca chama este método); só o `state` passa a usar
-- merge, pelo mesmo motivo de merge_lead_state acima.
create or replace function public.merge_lead_state_and_position(
  p_lead_id uuid,
  p_patch jsonb,
  p_flow_id uuid,
  p_node_id text,
  p_active_flow_name text default null,
  p_set_active_flow_name boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
as $$
declare
  v_new_state jsonb;
begin
  update public.leads
  set
    current_flow_id = p_flow_id,
    current_node_id = p_node_id,
    state = (
      coalesce(state, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
    ) - (
      select coalesce(array_agg(key), array[]::text[])
      from jsonb_each(coalesce(p_patch, '{}'::jsonb))
      where value = 'null'::jsonb
    ),
    active_flow_name = case
      when p_set_active_flow_name then p_active_flow_name
      else active_flow_name
    end
  where id = p_lead_id
  returning state into v_new_state;

  return v_new_state;
end;
$$;
