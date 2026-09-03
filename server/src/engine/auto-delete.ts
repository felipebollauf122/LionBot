/**
 * Auto-delete das mensagens enviadas por um bloco.
 *
 * A escolha do tempo é feita no editor de fluxo e gravada em
 * `node.data.auto_delete_seconds` (já normalizada em segundos — ver
 * `autoDeleteSeconds()` no flow-utils do painel). Aqui só lemos, validamos e
 * decidimos a precedência: o bloco manda; sem bloco, vale a regra do fluxo
 * (black flow ou `delete_after_minutes` do remarketing).
 */

/** Teto de 24h — o mesmo limite do auto-delete por fluxo (1440 min). */
export const AUTO_DELETE_MAX_SECONDS = 86400;

/**
 * @param data          `node.data` do bloco que acabou de enviar as mensagens.
 * @param fallbackSeconds Tempo do fluxo em segundos, ou null se o fluxo não deleta.
 * @returns Segundos até a deleção, ou null quando nada deve ser deletado.
 */
export function resolveAutoDeleteSeconds(
  data: Record<string, unknown>,
  fallbackSeconds: number | null,
): number | null {
  const raw = data.auto_delete_seconds;
  // Não-número, 0 ou negativo = bloco sem auto-delete próprio. Nunca deixamos
  // um valor corrompido no flow_data virar deleção (ou impedir a do fluxo).
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), AUTO_DELETE_MAX_SECONDS);
  }
  return fallbackSeconds && fallbackSeconds > 0 ? fallbackSeconds : null;
}
