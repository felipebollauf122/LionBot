import type { SupabaseClient } from "@supabase/supabase-js";

interface FindOrCreateParams {
  botId: string;
  tenantId: string;
  telegramUserId: number;
  firstName: string;
  lastName?: string | null;
  username: string | null;
  tid?: string;
  fbclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  bot_id: string;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  tid: string | null;
  fbclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  current_flow_id: string | null;
  current_node_id: string | null;
  active_flow_name: string | null;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class LeadService {
  constructor(private db: SupabaseClient) {}

  /**
   * Só a busca do lead — sem nenhuma escrita. Existe separada pra que o
   * webhook possa disparar esta query EM PARALELO com resolveTenantIdentity
   * (as duas são independentes: a identidade do tenant só é necessária pra
   * decidir a atribuição, não pra localizar o lead). Antes as duas rodavam
   * em série, custando 2 round-trips no caminho de toda mensagem.
   */
  async findLead(botId: string, telegramUserId: number): Promise<Lead | null> {
    const { data } = await this.db
      .from("leads")
      .select("*")
      .eq("bot_id", botId)
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    return (data as Lead | null) ?? null;
  }

  /**
   * Find existing lead (1 query for returning users — the common case)
   * or create a new one (2 queries only for first-time users).
   * First attribution is preserved: TID/UTMs are never overwritten once set.
   *
   * `prefetched` permite reaproveitar um findLead já resolvido (ver acima).
   * Passar `{ existing: null }` significa "já procurei e não achou" — não
   * confundir com omitir o argumento, que faz a busca aqui dentro.
   */
  async findOrCreateLead(
    params: FindOrCreateParams,
    prefetched?: { existing: Lead | null },
  ): Promise<Lead> {
    // Single query: try to find existing lead
    const existing = prefetched
      ? prefetched.existing
      : await this.findLead(params.botId, params.telegramUserId);

    if (existing) {
      const existingLead = existing as Lead;

      // Sincroniza atribuição com a identidade do tenant ("last touch"):
      //   - lead sem tid + identity traz tid → adota
      //   - lead já tem tid mas identity tem tid DIFERENTE (campanha
      //     nova) → atualiza pra refletir a campanha mais recente
      //   - se nada mudou, não toca em nada (evita writes desnecessários)
      const incomingHasTid = !!params.tid;
      const tidIsDifferent = incomingHasTid && params.tid !== existingLead.tid;
      if ((!existingLead.tid && incomingHasTid) || tidIsDifferent) {
        const { data: updated } = await this.db
          .from("leads")
          .update({
            tid: params.tid,
            fbclid: params.fbclid ?? null,
            utm_source: params.utmSource ?? null,
            utm_medium: params.utmMedium ?? null,
            utm_campaign: params.utmCampaign ?? null,
            utm_content: params.utmContent ?? null,
            utm_term: params.utmTerm ?? null,
          })
          .eq("id", existingLead.id)
          .select("*")
          .single();

        if (updated) return updated as Lead;
      }

      return existingLead;
    }

    // New lead: single insert
    const { data: created, error } = await this.db
      .from("leads")
      .insert({
        tenant_id: params.tenantId,
        bot_id: params.botId,
        telegram_user_id: params.telegramUserId,
        first_name: params.firstName,
        last_name: params.lastName ?? null,
        username: params.username,
        tid: params.tid ?? null,
        fbclid: params.fbclid ?? null,
        utm_source: params.utmSource ?? null,
        utm_medium: params.utmMedium ?? null,
        utm_campaign: params.utmCampaign ?? null,
        utm_content: params.utmContent ?? null,
        utm_term: params.utmTerm ?? null,
        state: {},
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create lead: ${error.message}`);
    }
    return created as Lead;
  }

  async updatePosition(leadId: string, flowId: string | null, nodeId: string | null, activeFlowName?: string): Promise<void> {
    const update: Record<string, unknown> = {
      current_flow_id: flowId,
      current_node_id: nodeId,
    };
    // Set active_flow_name when entering a flow, clear when flow ends
    if (activeFlowName !== undefined) {
      update.active_flow_name = activeFlowName;
    } else if (flowId === null) {
      update.active_flow_name = null;
    }
    const { error } = await this.db
      .from("leads")
      .update(update)
      .eq("id", leadId);

    if (error) {
      throw new Error(`Failed to update lead position: ${error.message}`);
    }
  }

  /**
   * Aplica um PATCH (delta) em leads.state via merge atômico no Postgres
   * (RPC merge_lead_state — migration 064) em vez de reescrever a coluna
   * inteira com um objeto já calculado em memória. Isso elimina o
   * lost-update quando dois writers escrevem `state` concorrentemente pro
   * mesmo lead (ex: remarketing-worker processando um snapshot antigo do
   * lead — carregado em bloco pra todos os leads do bot — vs webhook do
   * Telegram processando uma interação nova de fluxo regular): cada writer
   * só aplica seu delta sobre o state ATUAL do banco, sob lock de linha,
   * então quem escrever por último não apaga mais o delta de quem escreveu
   * antes.
   *
   * Convenção JSON Merge Patch (RFC 7396): uma chave com valor `null` no
   * patch REMOVE a chave do state (em vez de gravar `null` literal) —
   * equivalente ao `delete state.foo` que os callers faziam em memória
   * antes de montar o objeto completo pra chamar este método.
   *
   * Retorna o state MERGEADO de verdade, vindo do banco — quem chamar deve
   * preferir isso a um spread local otimista quando for guardar o resultado
   * em `lead.state`, já que outro writer pode ter tocado campos que este
   * caller não conhece.
   */
  async updateState(leadId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc("merge_lead_state", {
      p_lead_id: leadId,
      p_patch: patch,
    });

    if (error) {
      throw new Error(`Failed to update lead state: ${error.message}`);
    }
    return (data as Record<string, unknown> | null) ?? {};
  }

  /**
   * Atualiza posição + state numa única query (#33) — evita 2 roundtrips
   * quando o flow precisa persistir os dois ao mesmo tempo (ex: delay node).
   * `patch` é um DELTA (mesma convenção de updateState acima), mergeado
   * atomicamente via RPC merge_lead_state_and_position (migration 064) —
   * current_flow_id/current_node_id continuam sendo o valor literal
   * passado (essas colunas só são escritas em persistPosition=true, nunca
   * pelo remarketing-worker, então não sofrem a mesma race de `state`).
   */
  async updatePositionAndState(
    leadId: string,
    flowId: string | null,
    nodeId: string | null,
    patch: Record<string, unknown>,
    activeFlowName?: string,
  ): Promise<Record<string, unknown>> {
    const shouldSetActiveFlowName = activeFlowName !== undefined || flowId === null;
    const { data, error } = await this.db.rpc("merge_lead_state_and_position", {
      p_lead_id: leadId,
      p_patch: patch,
      p_flow_id: flowId,
      p_node_id: nodeId,
      p_active_flow_name: activeFlowName ?? null,
      p_set_active_flow_name: shouldSetActiveFlowName,
    });
    if (error) {
      throw new Error(`Failed to update lead position+state: ${error.message}`);
    }
    return (data as Record<string, unknown> | null) ?? {};
  }

  async getById(leadId: string): Promise<Lead | null> {
    const { data } = await this.db
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();

    return data as Lead | null;
  }
}
