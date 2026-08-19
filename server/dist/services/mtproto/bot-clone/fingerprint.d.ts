export interface FingerprintMessage {
    text: string | null;
    mediaKind: string;
    buttonLabels: string[];
}
export interface FingerprintInput {
    messages: FingerprintMessage[];
}
/**
 * Fingerprint de um "turno" (burst de mensagens) pra detecção de loop.
 * Rótulos de botão passam pelo MESMO scrub que o texto (achado #3 da
 * revisão adversarial): sem isso, um botão com token por visita
 * ("Confirmar #48291") nunca repete a fingerprint, o corte de loop nunca
 * dispara, e esse botão específico é clicado de novo a cada visita até o
 * teto de profundidade/nós.
 */
export declare function computeStateFingerprint(input: FingerprintInput): string;
