import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceCandidate } from "./price-candidates.js";
/**
 * Cria produto + bundle de 1 item por preço distinto encontrado na
 * clonagem. Best-effort por candidato (mesmo padrão de tolerância do resto
 * de bot-clone-handler.ts) — falha num candidato não aborta os demais nem
 * o job; o botão correspondente simplesmente cai no fallback unmapped em
 * transcript-to-flow.ts (a chave dele nunca entra no Map devolvido aqui).
 */
export declare function createClonedProductsAndBundles(db: SupabaseClient, params: {
    tenantId: string;
    botId: string;
}, candidates: Map<string, PriceCandidate>): Promise<Map<string, string>>;
