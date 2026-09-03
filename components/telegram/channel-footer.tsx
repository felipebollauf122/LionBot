import type { TelegramDevice } from "@/components/telegram/channel-header";
import { GiftIcon, SearchIcon } from "@/components/telegram/icons";

/**
 * Rodapé decorativo do canal.
 *
 * iPhone: presente · "Silenciar" · lupa, três peças de vidro de 40px
 * flutuando sobre o chat, como no iOS 26. A pílula do meio tem largura fixa
 * (165px na print), não estica até os círculos.
 *
 * Android: faixa opaca de 50dp com "SILENCIAR" em azul.
 */
export function ChannelFooter({
  device = "android",
}: {
  device?: TelegramDevice;
}) {
  return (
    <footer className={`tg-channel-footer tg-channel-footer--${device}`}>
      {device === "iphone" ? (
        <div className="tg-ios-footer-actions">
          <button type="button" className="tg-footer-circle tg-glass" aria-label="Presentear">
            <GiftIcon />
          </button>
          <button type="button" className="tg-mute-pill tg-glass">
            Silenciar
          </button>
          <button type="button" className="tg-footer-circle tg-glass" aria-label="Pesquisar">
            <SearchIcon />
          </button>
        </div>
      ) : (
        <div className="tg-android-footer-action">SILENCIAR</div>
      )}
    </footer>
  );
}
