/**
 * Imagem ou vídeo dentro da bolha.
 *
 * Quando a mensagem tem legenda, os cantos de baixo ficam retos: a mídia
 * encosta no texto, e é assim que o Telegram desenha. Sem legenda, a mídia
 * herda o raio da bolha inteira.
 *
 * loading="lazy" porque o feed pode ser longo e o lead costuma estar em 4G.
 */
import type { CSSProperties } from "react";

export function MediaContainer({
  url,
  type,
  hasCaption,
}: {
  url: string;
  type: "image" | "video";
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

  if (type === "video") {
    return <video src={url} style={style} controls playsInline preload="metadata" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" style={style} />
  );
}
