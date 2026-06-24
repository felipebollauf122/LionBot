import type { SupabaseClient } from "@supabase/supabase-js";
export interface IncomingTracking {
    tid?: string;
    fbclid?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
}
export interface ResolvedIdentity {
    tid: string | null;
    fbclid: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
}
/**
 * Resolve a identidade de tracking de um lead dentro de um tenant.
 *
 * Comportamento:
 *  - Se `incoming` traz tid/fbclid/UTMs: ATUALIZA o registro do tenant
 *    com esses valores (atribuição "last touch") e retorna o que foi
 *    salvo. Cada bot novo desse tenant que esse user entrar via campanha
 *    nova passa a ter o tid mais recente — comportamento que o user
 *    pediu explicitamente.
 *  - Se `incoming` está vazio (link direto, deeplink antigo, etc): USA
 *    o que já estava salvo na tabela tenant_lead_identity. Lead que
 *    entrou no bot A com campanha e agora aparece no bot B sem nada
 *    "herda" a atribuição original.
 *  - Se não tem registro nenhum e nada veio: retorna tudo null.
 *
 * Sempre faz um upsert do registro do tenant com last_bot_id atual
 * pra manter a tabela viva como "memória" do tenant.
 */
export declare function resolveTenantIdentity(db: SupabaseClient, tenantId: string, telegramUserId: number, botId: string, incoming: IncomingTracking): Promise<ResolvedIdentity>;
