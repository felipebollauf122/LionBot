import type { MediaItem } from "@/lib/social-proof/types";

const MAX_VISIVEL = 4;

/**
 * Grade de álbum. O Telegram mostra no máximo quatro peças e resume o resto
 * como "+N" sobre a última — mostrar todas transformaria a bolha numa parede.
 */
export function AlbumGrid({ media }: { media: MediaItem[] }) {
  const visiveis = media.slice(0, MAX_VISIVEL);
  const excedente = media.length - visiveis.length;

  return (
    <div className="tg-album">
      {visiveis.map((item, i) => (
        <div className="tg-album-item" key={`${item.url}-${i}`}>
          {item.type === "video" ? (
            <video src={item.url} preload="metadata" muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt="" loading="lazy" />
          )}

          {excedente > 0 && i === visiveis.length - 1 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 22,
                fontWeight: 500,
              }}
            >
              +{excedente}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
