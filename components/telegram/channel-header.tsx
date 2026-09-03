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
}: {
  channel: FeedChannel;
  device?: TelegramDevice;
}) {
  return (
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
  );
}
