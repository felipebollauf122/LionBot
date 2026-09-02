/**
 * Uma peça de mídia dentro da bolha.
 *
 * Quando a mensagem tem legenda, os cantos de baixo ficam retos: a mídia
 * encosta no texto, e é assim que o Telegram desenha.
 *
 * Vídeo com duração ganha a sobreposição no canto, como no app real. Sem
 * duração conhecida a sobreposição some — melhor nada que "0:00" mentiroso.
 */
import type { CSSProperties } from "react";
import type { MediaItem } from "@/lib/social-proof/types";
import { formatDuration } from "@/lib/social-proof/media";

export function MediaContainer({
  item,
  hasCaption,
}: {
  item: MediaItem;
  hasCaption: boolean;
}) {
  const radius = hasCaption
    ? "calc(var(--tgc-bubble-radius) - 3px) calc(var(--tgc-bubble-radius) - 3px) 0 0"
    : "calc(var(--tgc-bubble-radius) - 3px)";

  const style: CSSProperties = {
    display: "block",
    width: "100%",
    maxHeight: 420,
    objectFit: "cover",
    borderRadius: radius,
    background: "var(--tgc-veil)",
  };

  if (item.type === "video") {
    return (
      <div style={{ position: "relative" }}>
        <video src={item.url} style={style} controls playsInline preload="metadata" />
        {typeof item.durationSeconds === "number" && (
          <span className="tg-media-duration">{formatDuration(item.durationSeconds)}</span>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.url} alt="" loading="lazy" style={style} />
  );
}
