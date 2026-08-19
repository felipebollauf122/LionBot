import type { PersistedButton } from "./explorer.js";
/**
 * Extrai preço de rótulo de botão pra criar produto real na clonagem de bot
 * (não confundir com o guard de payment-guard.ts, que decide se CLICA num
 * botão — esse aqui roda só depois, sobre botões que o guard já pulou).
 */
/** Mesmo universo de botões que transcript-to-flow.ts vira "unmapped" — fonte única, nunca diverge. */
export declare function isCandidateSkipButton(btn: PersistedButton): boolean;
export declare function normalizeLabelForDedupKey(label: string): string;
export declare function parsePriceCentsFromLabel(label: string): number | null;
