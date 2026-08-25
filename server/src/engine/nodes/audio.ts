import type { NodeContext, NodeResult } from "../types.js";
import { findNextNodeId } from "./text.js";

/** Teto duro do "gravando áudio…": o worker fica parado nesse tempo, então
 *  nem a config nem um flow importado podem esticar isso indefinidamente. */
const MAX_RECORDING_SECONDS = 8;
/** A ação de chat da Telegram expira sozinha em ~5s — re-emitimos antes disso
 *  pra indicações mais longas não piscarem no meio. */
const CHAT_ACTION_REFRESH_MS = 4_000;

// Mesma regra de image.ts/video.ts: aceita URL http(s) ou file_id do Telegram,
// rejeita vazio, "undefined"/"null" e texto solto que só viraria erro na API.
function isValidMediaRef(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v === "undefined" || v === "null") return false;
  if (/^https?:\/\/\S+/i.test(v)) return true;
  if (/^[A-Za-z0-9_-]{20,}$/.test(v)) return true;
  return false;
}

/** Segundos de "gravando áudio…" pedidos pelo nó, saneados: número finito,
 *  não-negativo e dentro do teto. Vale 0 (sem simulação). */
export function recordingSecondsOf(data: Record<string, unknown>): number {
  if (data.simulate_recording === false) return 0;
  const raw = Number(data.recording_seconds ?? 2);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.round(raw), MAX_RECORDING_SECONDS);
}

/**
 * Envia um áudio como MENSAGEM DE VOZ (bolha de waveform, play inline) — não
 * como arquivo anexado. Antes disso mostra "gravando áudio…" pelo tempo
 * configurado, pra chegada do áudio parecer uma gravação de verdade.
 */
export async function handleAudioNode(ctx: NodeContext): Promise<NodeResult> {
  const audio = String(ctx.node.data.audio_url ?? "");
  const caption = ctx.node.data.caption ? String(ctx.node.data.caption) : undefined;
  const durationRaw = Number(ctx.node.data.duration ?? 0);
  const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;
  const next = findNextNodeId(ctx.edges, ctx.node.id);

  if (!isValidMediaRef(audio)) {
    console.warn(
      `[audio-node] node=${ctx.node.id} pulado: audio_url inválido (valor=${JSON.stringify(audio)}).`,
    );
    return { nextNodeId: next };
  }

  const recordingSeconds = recordingSecondsOf(ctx.node.data);
  if (recordingSeconds > 0) {
    let elapsed = 0;
    while (elapsed < recordingSeconds * 1000) {
      await ctx.telegram.sendChatAction(ctx.chatId, "record_voice");
      const slice = Math.min(CHAT_ACTION_REFRESH_MS, recordingSeconds * 1000 - elapsed);
      await new Promise((r) => setTimeout(r, slice));
      elapsed += slice;
    }
  }

  const sent = await ctx.telegram.sendVoice({
    chatId: ctx.chatId,
    voice: audio,
    caption,
    duration,
  });

  return {
    nextNodeId: next,
    messageIds: sent ? [sent.message_id] : undefined,
  };
}
