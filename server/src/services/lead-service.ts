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

  async updateState(leadId: string, state: Record<string, unknown>): Promise<void> {
    const { error } = await this.db
      .from("leads")
      .update({ state })
      .eq("id", leadId);

    if (error) {
      throw new Error(`Failed to update lead state: ${error.message}`);
    }
  }

  /**
   * Atualiza posição + state numa única query (#33) — evita 2 roundtrips
   * quando o flow precisa persistir os dois ao mesmo tempo (ex: delay node).
   */
  async updatePositionAndState(
    leadId: string,
    flowId: string | null,
    nodeId: string | null,
    state: Record<string, unknown>,
    activeFlowName?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      current_flow_id: flowId,
      current_node_id: nodeId,
      state,
    };
    if (activeFlowName !== undefined) {
      update.active_flow_name = activeFlowName;
    } else if (flowId === null) {
      update.active_flow_name = null;
    }
    const { error } = await this.db.from("leads").update(update).eq("id", leadId);
    if (error) {
      throw new Error(`Failed to update lead position+state: ${error.message}`);
    }
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
