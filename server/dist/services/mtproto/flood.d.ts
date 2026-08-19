/**
 * Extrai o tempo de espera de um erro de flood do Telegram.
 *
 * ARMADILHA: FloodWaitError.message é "A wait of N seconds is required
 * (caused by ...)" — a string "FLOOD" só existe em `errorMessage`. Qualquer
 * detecção por regex na mensagem falha silenciosamente. Detectar por classe.
 */
export declare function extractWaitSeconds(err: unknown): number | null;
