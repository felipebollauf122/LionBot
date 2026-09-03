import type { MediaItem } from "@/lib/social-proof/types";
import { formatDuration } from "@/lib/social-proof/media";

const BARRAS = 28;

/**
 * Onda estática derivada de um hash da seed (o id da mensagem).
 *
 * Não há análise do arquivo: áudio simulado com onda plausível convence, e
 * decodificar o arquivo custaria processamento sem ganho visual proporcional.
 * O que importa é ser DETERMINÍSTICO — onda diferente a cada render entregaria
 * o truque na primeira vez que o lead rolasse a tela de volta.
 */
function alturas(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const out: number[] = [];
  for (let i = 0; i < BARRAS; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h |= 0;
    // 6px a 24px — nunca zero, senão a barra some e a onda fica esburacada.
    out.push(6 + (Math.abs(h) % 19));
  }
  return out;
}

export function AudioBubble({ item, seed }: { item: MediaItem; seed: string }) {
  return (
    <div className="tg-audio">
      <span className="tg-audio-play" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>

      <span className="tg-audio-wave" aria-hidden>
        {alturas(seed).map((h, i) => (
          <span key={i} className="tg-audio-bar" style={{ height: h }} />
        ))}
      </span>

      <span style={{ color: "var(--tgc-meta)", fontSize: 12, flexShrink: 0 }}>
        {formatDuration(item.durationSeconds ?? 0)}
      </span>
    </div>
  );
}
