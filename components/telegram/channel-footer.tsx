import type { TelegramDevice } from "@/components/telegram/channel-header";

function GiftIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 10h18v11H3zM2 7h20v3H2zM12 7v14M12 7H8.5A2.5 2.5 0 1 1 11 4.5V7ZM12 7h3.5A2.5 2.5 0 1 0 13 4.5V7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.9" />
      <path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function VolumeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m18 9 4 6m0-6-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SystemNavBar() {
  return (
    <div className="tg-system-nav" aria-hidden>
      <span className="tg-system-nav__recent" />
      <span className="tg-system-nav__home" />
      <span className="tg-system-nav__back" />
    </div>
  );
}

export function ChannelFooter({
  device = "android",
  preview = false,
}: {
  device?: TelegramDevice;
  preview?: boolean;
}) {
  return (
    <footer className={`tg-channel-footer tg-channel-footer--${device}`}>
      {device === "iphone" ? (
        <div className="tg-ios-footer-actions">
          <button type="button" className="tg-footer-circle" aria-label="Presentear">
            <GiftIcon />
          </button>
          <button type="button" className="tg-mute-pill">
            <VolumeOffIcon />
            <span>Silenciar</span>
          </button>
          <button type="button" className="tg-footer-circle" aria-label="Pesquisar">
            <SearchIcon />
          </button>
        </div>
      ) : (
        <div className="tg-android-footer-action">SILENCIAR</div>
      )}
      {device === "iphone" && preview && <div className="tg-ios-home-indicator" aria-hidden />}
      {device === "android" && preview && <SystemNavBar />}
    </footer>
  );
}
