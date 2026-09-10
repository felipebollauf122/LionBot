/**
 * Aviso de limite de envio do Telegram (rate limit / "flood wait") numa
 * campanha agendada.
 *
 * O worker (scheduled-campaign-handler.ts, reagendarPorFlood) reconhece um
 * 429 da Bot API, grava `error_message: "flood_wait_<segundos>s"` na
 * mensagem que tomou o limite e empurra `scheduled_at` de TODAS as
 * pendentes pra frente — a campanha continua correta, só que pode ficar
 * horas sem publicar nada, e sem isto a tela não dizia por quê (Ruling 23
 * desta branch). Quem abre a campanha não sabe o que é "flood wait": as
 * funções abaixo traduzem pra "o Telegram limitou, volta às HH:MM", nunca a
 * string crua.
 */

import { formatClock } from "@/lib/social-proof/format";

export interface FloodWait {
  waitSeconds: number;
  resumesAt: Date;
}

const PADRAO_FLOOD = /^flood_wait_(\d+)s$/;

/**
 * Reconhece o formato exato que o worker grava. Qualquer outro texto em
 * `error_message` é um erro de verdade (falha de envio, retry em curso) —
 * não um limite do Telegram, e não deve ser traduzido como se fosse um.
 */
export function parseFloodWait(
  errorMessage: string | null | undefined,
  scheduledAt: string | null | undefined,
): FloodWait | null {
  if (!errorMessage || !scheduledAt) return null;
  const m = PADRAO_FLOOD.exec(errorMessage);
  if (!m) return null;
  const resumesAt = new Date(scheduledAt);
  if (Number.isNaN(resumesAt.getTime())) return null;
  return { waitSeconds: Number(m[1]), resumesAt };
}

/**
 * Frase para quem não sabe o que é "flood wait": nomeia o Telegram (não a
 * campanha) como origem do limite, diz que não é erro, e quando volta.
 */
export function describeFloodWait(flood: FloodWait): string {
  return `O Telegram limitou o envio temporariamente. A publicação continua sozinha às ${formatClock(
    flood.resumesAt,
  )} — nada foi perdido, é só aguardar.`;
}

/** Texto pronto pro `title` (hover) do chip de status de uma mensagem — null
 *  quando a linha não está esperando o limite do Telegram. */
export function messageFloodHint(
  errorMessage: string | null | undefined,
  scheduledAt: string | null | undefined,
): string | null {
  const flood = parseFloodWait(errorMessage, scheduledAt);
  return flood ? describeFloodWait(flood) : null;
}

/**
 * A espera mais próxima entre as linhas ainda pendentes da campanha — é
 * quando a PRÓXIMA publicação volta a acontecer. Normalmente só uma linha
 * carrega `error_message` de flood por vez (é a que tomou o 429; as outras
 * só têm `scheduled_at` empurrado), mas a função aceita mais de uma sem
 * quebrar, escolhendo a que retoma primeiro.
 */
export function earliestFloodWait(
  rows: Array<{
    status: string;
    error_message: string | null | undefined;
    scheduled_at: string | null | undefined;
  }>,
): FloodWait | null {
  let melhor: FloodWait | null = null;
  for (const r of rows) {
    if (r.status !== "pending") continue;
    const flood = parseFloodWait(r.error_message, r.scheduled_at);
    if (!flood) continue;
    if (!melhor || flood.resumesAt.getTime() < melhor.resumesAt.getTime()) melhor = flood;
  }
  return melhor;
}
