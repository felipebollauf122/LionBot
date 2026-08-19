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
export declare class LeadService {
    private db;
    constructor(db: SupabaseClient);
    /**
     * Só a busca do lead — sem nenhuma escrita. Existe separada pra que o
     * webhook possa disparar esta query EM PARALELO com resolveTenantIdentity
     * (as duas são independentes: a identidade do tenant só é necessária pra
     * decidir a atribuição, não pra localizar o lead). Antes as duas rodavam
     * em série, custando 2 round-trips no caminho de toda mensagem.
     */
    findLead(botId: string, telegramUserId: number): Promise<Lead | null>;
    /**
     * Find existing lead (1 query for returning users — the common case)
     * or create a new one (2 queries only for first-time users).
     * First attribution is preserved: TID/UTMs are never overwritten once set.
     *
     * `prefetched` permite reaproveitar um findLead já resolvido (ver acima).
     * Passar `{ existing: null }` significa "já procurei e não achou" — não
     * confundir com omitir o argumento, que faz a busca aqui dentro.
     */
    findOrCreateLead(params: FindOrCreateParams, prefetched?: {
        existing: Lead | null;
    }): Promise<Lead>;
    updatePosition(leadId: string, flowId: string | null, nodeId: string | null, activeFlowName?: string): Promise<void>;
    updateState(leadId: string, state: Record<string, unknown>): Promise<void>;
    /**
     * Atualiza posição + state numa única query (#33) — evita 2 roundtrips
     * quando o flow precisa persistir os dois ao mesmo tempo (ex: delay node).
     */
    updatePositionAndState(leadId: string, flowId: string | null, nodeId: string | null, state: Record<string, unknown>, activeFlowName?: string): Promise<void>;
    getById(leadId: string): Promise<Lead | null>;
}
export {};
