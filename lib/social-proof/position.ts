/**
 * Próxima `position` de uma mensagem do feed, dado o maior valor já usado no
 * canal (ou null quando o canal está vazio).
 *
 * Mora fora de lib/actions/social-proof-actions.ts porque um módulo
 * "use server" só pode exportar função async — e porque esta é a regra que
 * substituiu o `messages.length + 1` do composer, que colidia: com 3 mensagens
 * (positions 1,2,3), apagar a do meio e recarregar a página fazia length+1
 * voltar a valer 3, duplicando uma position que já existia. max+1 nunca volta
 * atrás, mesmo com buracos no meio.
 *
 * Canal vazio começa em 1 (mesma base que o composer usava). Um max negativo
 * ou zero — possível porque a coluna tem `default 0` e nada impede um valor
 * plantado à mão — também cai em 1, nunca em 0 ou negativo.
 */
export function nextPosition(maxPosition: number | null | undefined): number {
  if (typeof maxPosition !== "number" || !Number.isFinite(maxPosition)) return 1;
  return Math.max(1, Math.floor(maxPosition) + 1);
}
