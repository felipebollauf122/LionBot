import type { FeedChannel } from "@/lib/social-proof/types";
import {
  ChevronBackIcon,
  MaterialBackIcon,
  MoreVertIcon,
  VerifiedIcon,
} from "@/components/telegram/icons";

export type TelegramDevice = "iphone" | "android";

function ChannelAvatar({ channel }: { channel: FeedChannel }) {
  if (channel.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={channel.avatarUrl} alt={channel.title} className="tg-channel-avatar" />;
  }

  return (
    <div className="tg-channel-avatar tg-channel-avatar--fallback">
      {channel.title.trim().charAt(0).toUpperCase() || "#"}
    </div>
  );
}

/**
 * Cabeçalho do canal.
 *
 * iPhone: três pílulas de vidro flutuando sobre o chat — voltar (com o
 * contador de não lidas), título centralizado e avatar com anel. O botão de
 * voltar só cresce quando há contador; sem ele vira um círculo de 44px.
 *
 * Android: action bar opaca de 56dp com seta, avatar de 42dp, título e menu.
 */
export function ChannelHeader({
  channel,
  device = "iphone",
}: {
  channel: FeedChannel;
  device?: TelegramDevice;
}) {
  if (device === "android") {
    return (
      <header className="tg-channel-header tg-channel-header--android">
        <div className="tg-channel-header__back" aria-hidden>
          <MaterialBackIcon />
        </div>
        <ChannelAvatar channel={channel} />
        <div className="tg-channel-header__copy">
          <div className="tg-channel-header__title">
            <span>{channel.title}</span>
            {channel.isVerified && <VerifiedIcon />}
          </div>
          <div className="tg-channel-header__subscribers">{channel.subscribersLabel}</div>
        </div>
        <div className="tg-channel-header__overflow" aria-hidden>
          <MoreVertIcon />
        </div>
      </header>
    );
  }

  const temBadge = channel.unreadBadge > 0;

  return (
    <header className="tg-channel-header tg-channel-header--iphone">
      <div
        className={`tg-channel-header__back tg-glass${temBadge ? "" : " tg-channel-header__back--solo"}`}
        aria-hidden
      >
        <ChevronBackIcon />
        {temBadge && <span className="tg-unread-badge">{channel.unreadBadge}</span>}
      </div>

      <div className="tg-channel-header__center">
        <div className="tg-channel-header__copy tg-glass">
          <div className="tg-channel-header__title">
            <span>{channel.title}</span>
            {channel.isVerified && <VerifiedIcon />}
          </div>
          <div className="tg-channel-header__subscribers">{channel.subscribersLabel}</div>
        </div>
      </div>

      <div className="tg-channel-header__ios-avatar" aria-hidden>
        <ChannelAvatar channel={channel} />
      </div>
    </header>
  );
}
