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
  return null;
}
