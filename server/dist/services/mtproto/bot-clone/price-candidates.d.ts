import type { CapturedNodeForFlow } from "./transcript-to-flow.js";
export interface PriceCandidate {
    dedupKey: string;
    label: string;
    cents: number;
}
/**
 * Varre fluxo principal + bursts de remarketing (concatenados pelo chamador
 * numa única lista) e devolve os preços distintos encontrados, deduplicados
 * pelo rótulo completo — mesmo nome com preço diferente (ex.: oferta com
 * desconto no remarketing) vira candidato à parte de propósito.
 */
export declare function collectPriceCandidates(nodes: CapturedNodeForFlow[]): Map<string, PriceCandidate>;
