import { isCandidateSkipButton, normalizeLabelForDedupKey, parsePriceCentsFromLabel } from "./price-parser.js";
/**
 * Varre fluxo principal + bursts de remarketing (concatenados pelo chamador
 * numa única lista) e devolve os preços distintos encontrados, deduplicados
 * pelo rótulo completo — mesmo nome com preço diferente (ex.: oferta com
 * desconto no remarketing) vira candidato à parte de propósito.
 */
export function collectPriceCandidates(nodes) {
    const candidates = new Map();
    for (const node of nodes) {
        for (const msg of node.messages) {
            for (const btn of msg.buttons) {
                if (!isCandidateSkipButton(btn))
                    continue;
                const cents = parsePriceCentsFromLabel(btn.label);
                if (cents === null)
                    continue;
                const dedupKey = normalizeLabelForDedupKey(btn.label);
                if (!candidates.has(dedupKey)) {
                    candidates.set(dedupKey, { dedupKey, label: btn.label.trim(), cents });
                }
            }
        }
    }
    return candidates;
}
