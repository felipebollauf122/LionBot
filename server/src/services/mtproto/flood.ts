import { FloodWaitError, SlowModeWaitError } from "telegram/errors/index.js";

/**
 * Extrai o tempo de espera de um erro de flood do Telegram.
 *
 * ARMADILHA: FloodWaitError.message é "A wait of N seconds is required
 * (caused by ...)" — a string "FLOOD" só existe em `errorMessage`. Qualquer
 * detecção por regex na mensagem falha silenciosamente. Detectar por classe.
 */
export function extractWaitSeconds(err: unknown): number | null {
  if (err instanceof FloodWaitError || err instanceof SlowModeWaitError) {
    return typeof err.seconds === "number" ? err.seconds : null;
  }
  // Retrocompat: erros forjados em teste ou vindos de wrappers antigos que
  // carregam `seconds` e mencionam flood no texto.
  if (err && typeof err === "object") {
    const e = err as { seconds?: number; message?: string; errorMessage?: string };
    const text = `${e.message ?? ""} ${e.errorMessage ?? ""}`;
    if (typeof e.seconds === "number" && /FLOOD|SLOWMODE/i.test(text)) return e.seconds;
  }
  // SEGUNDA ARMADILHA, a da Bot API: quem publica de verdade (clone e
  // campanhas agendadas) fala grammy, não gramjs, e o rate limit de lá é um
  // GrammyError com `error_code: 429` e os segundos em
  // `parameters.retry_after`. Não tem campo `seconds` e a mensagem é
  // "Call to 'sendMessage' failed! (429: Too Many Requests: retry after 30)"
  // — sem "FLOOD" nenhum. Nenhuma das duas detecções acima o enxerga, então
  // sem este bloco todo flood da Bot API era tratado como erro genérico.
  if (err && typeof err === "object") {
    const e = err as { error_code?: unknown; parameters?: { retry_after?: unknown } | null };
    if (e.error_code === 429) {
      const retryAfter = e.parameters?.retry_after;
      if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) return retryAfter;
    }
  }
  return null;
}
