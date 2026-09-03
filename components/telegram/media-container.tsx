/**
 * Uma peça de mídia dentro da bolha.
 *
 * Quando a mensagem tem legenda, os cantos de baixo ficam retos: a mídia
 * encosta no texto, e é assim que o Telegram desenha. Sem legenda, a hora vai
 * numa pílula translúcida sobre a mídia (vem por `children`).
 *
 * Vídeo com duração ganha a sobreposição no canto, como no app real. Sem
 * duração conhecida a sobreposição some — melhor nada que "0:00" mentiroso.
 */
import type { ReactNode } from "react";
import type { MediaItem } from "@/lib/social-proof/types";
import { formatDuration } from "@/lib/social-proof/media";

export function MediaContainer({
  item,
  hasCaption,
  children,
}: {
  item: MediaItem;
  hasCaption: boolean;
  children?: ReactNode;
}) {
  const classe = `tg-media ${hasCaption ? "tg-media--rounded-top" : "tg-media--rounded"}`;

  return (
    <div className={classe}>
      {item.type === "video" ? (
        <>
          <video src={item.url} controls playsInline preload="metadata" />
          {typeof item.durationSeconds === "number" && (
            <span className="tg-media-duration">{formatDuration(item.durationSeconds)}</span>
          )}
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading="lazy" />
      )}
      {children}
    </div>
  );
}
