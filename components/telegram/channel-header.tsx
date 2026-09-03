import type { FeedChannel } from "@/lib/social-proof/types";

export type TelegramDevice = "iphone" | "android";

function BackIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OverflowIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function StatusIcons() {
  return (
    <span className="tg-status-icons" aria-hidden>
      <svg width="18" height="15" viewBox="0 0 18 15" fill="none">
        <path d="M1 14V11M5 14V8M9 14V5M13 14V2M17 14V0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <svg width="19" height="15" viewBox="0 0 24 18" fill="none">
        <path d="M2 6.5a14 14 0 0 1 20 0M5 10a10 10 0 0 1 14 0M8.5 13.5a5 5 0 0 1 7 0M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="tg-battery"><span /></span>
    </span>
  );
}

function PreviewStatusBar({ device }: { device: TelegramDevice }) {
  return (
    <div className={`tg-preview-status tg-preview-status--${device}`} aria-hidden>
      <span>{device === "iphone" ? "04:14" : "11:05"}</span>
      <StatusIcons />
    </div>
  );
}

function ChannelAvatar({ channel, size }: { channel: FeedChannel; size: number }) {
  const style = { width: size, height: size };
  if (channel.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={channel.avatarUrl} alt={channel.title} className="tg-channel-avatar" style={style} />;
  }

  return (
    <div className="tg-channel-avatar tg-channel-avatar--fallback" style={style}>
      {channel.title.trim().charAt(0).toUpperCase() || "#"}
    </div>
  );
}

function VerifiedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-label="verificado" className="tg-verified-icon">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M7 12.5 10.2 15.7 17 9" stroke="var(--tgc-verified-check)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function ChannelHeader({
  channel,
  device = "iphone",
  preview = false,
}: {
  channel: FeedChannel;
  device?: TelegramDevice;
  preview?: boolean;
}) {
  return (
    <>
      {preview && <PreviewStatusBar device={device} />}
      <header className={`tg-channel-header tg-channel-header--${device}`}>
        <div className="tg-channel-header__back" aria-hidden>
          <BackIcon />
          {device === "iphone" && channel.unreadBadge > 0 && (
            <span className="tg-unread-badge">{channel.unreadBadge}</span>
          )}
        </div>

        {device === "android" && <ChannelAvatar channel={channel} size={40} />}

        <div className="tg-channel-header__copy">
          <div className="tg-channel-header__title">
            <span>{channel.title}</span>
            {channel.isVerified && <VerifiedIcon />}
          </div>
          <div className="tg-channel-header__subscribers">{channel.subscribersLabel}</div>
        </div>

        {device === "iphone" ? (
          <div className="tg-channel-header__ios-avatar" aria-hidden>
            <ChannelAvatar channel={channel} size={48} />
          </div>
        ) : (
          <div className="tg-channel-header__overflow" aria-hidden>
            <OverflowIcon />
          </div>
        )}
      </header>
    </>
  );
}
