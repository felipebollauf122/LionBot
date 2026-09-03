import { PinListIcon } from "@/components/telegram/icons";

/**
 * Barra "Mensagem fixada", entre o cabeçalho do canal e o feed.
 *
 * No iPhone é uma pílula de vidro de 50px flutuando sobre o chat, com a
 * linha tracejada à esquerda e, quando a mensagem fixada tem foto, a
 * miniatura de 36px. Foto sem legenda vira "Foto", como no app. Sem texto e
 * sem foto não renderiza nada: uma barra vazia é mais estranha que a
 * ausência dela.
 */
export function PinnedBar({ text, thumbUrl = null }: { text: string; thumbUrl?: string | null }) {
  const rotulo = text.trim() !== "" ? text : thumbUrl ? "Foto" : "";
  if (rotulo === "") return null;

  return (
    <div className="tg-pinned tg-glass">
      <span className="tg-pinned__line" aria-hidden />
      {thumbUrl && (
        <span className="tg-pinned__thumb" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbUrl} alt="" loading="lazy" />
        </span>
      )}
      <div className="tg-pinned__copy">
        <div className="tg-pinned-title">Mensagem fixada</div>
        <div className="tg-pinned-text">{rotulo}</div>
      </div>
      <span className="tg-pinned__icon" aria-hidden>
        <PinListIcon />
      </span>
    </div>
  );
}
