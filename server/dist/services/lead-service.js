export class LeadService {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Find existing lead (1 query for returning users — the common case)
     * or create a new one (2 queries only for first-time users).
     * First attribution is preserved: TID/UTMs are never overwritten once set.
     */
    async findOrCreateLead(params) {
        // Single query: try to find existing lead
        const { data: existing } = await this.db
            .from("leads")
            .select("*")
            .eq("bot_id", params.botId)
            .eq("telegram_user_id", params.telegramUserId)
            .maybeSingle();
        if (existing) {
            const existingLead = existing;
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
                if (updated)
                    return updated;
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
        return created;
    }
    async updatePosition(leadId, flowId, nodeId, activeFlowName) {
        const update = {
            current_flow_id: flowId,
            current_node_id: nodeId,
        };
        // Set active_flow_name when entering a flow, clear when flow ends
        if (activeFlowName !== undefined) {
            update.active_flow_name = activeFlowName;
        }
        else if (flowId === null) {
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
    async updateState(leadId, state) {
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
    async updatePositionAndState(leadId, flowId, nodeId, state, activeFlowName) {
        const update = {
            current_flow_id: flowId,
            current_node_id: nodeId,
            state,
        };
        if (activeFlowName !== undefined) {
            update.active_flow_name = activeFlowName;
        }
        else if (flowId === null) {
            update.active_flow_name = null;
        }
        const { error } = await this.db.from("leads").update(update).eq("id", leadId);
        if (error) {
            throw new Error(`Failed to update lead position+state: ${error.message}`);
        }
    }
    async getById(leadId) {
        const { data } = await this.db
            .from("leads")
            .select("*")
            .eq("id", leadId)
            .maybeSingle();
        return data;
    }
}
