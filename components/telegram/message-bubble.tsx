import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { MediaContainer } from "@/components/telegram/media-container";
import { AlbumGrid } from "@/components/telegram/album-grid";
import { AudioBubble } from "@/components/telegram/audio-bubble";
import { ReplyPreview } from "@/components/telegram/reply-preview";
import { ReactionsRow } from "@/components/telegram/reactions-row";
import { resolveSender } from "@/lib/social-proof/sender";

/**
 * A bolha. Sempre alinhada à esquerda — o Mini App simula um canal de
 * terceiros, então nunca existe mensagem "própria" do lead.
 *
 * O rabinho aparece só na última mensagem do grupo. O selo "admin"
 * fica à direita do nome, como no mockup.
 */
export function MessageBubble({
  message,
  channel,
}: {
  message: GroupedMessage;
  channel: FeedChannel;
}) {
  const sender = resolveSender(message, channel);
  const temMidia = message.media.length > 0;
  const ehAlbum = message.media.length > 1;
  const ehAudio = !ehAlbum && message.media[0]?.type === "audio";
  const temTexto = message.contentText !== null && message.contentText.trim() !== "";
  const temResposta = message.replyToText !== null;

  const classes = [
    "tg-bubble",
    message.isLastOfGroup ? "tg-bubble--tail" : "",
    temMidia && !ehAudio && temTexto ? "tg-bubble--media" : "",
    temMidia && !ehAudio && !temTexto ? "tg-bubble--media-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {message.isFirstOfGroup && (
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <SenderName name={sender.name} />
          {sender.badge && <span className="tg-owner-badge">{sender.badge}</span>}
        </div>
      )}

      {temResposta && (
        <ReplyPreview sender={message.replyToSender ?? ""} text={message.replyToText ?? ""} />
      )}

      {ehAlbum && <AlbumGrid media={message.media} />}
      {ehAudio && <AudioBubble item={message.media[0]} seed={message.id} />}
      {temMidia && !ehAlbum && !ehAudio && (
        <MediaContainer item={message.media[0]} hasCaption={temTexto} />
      )}

      {temTexto && (
        <div
          className="tg-bubble-text"
          style={{ whiteSpace: "pre-wrap", marginTop: temMidia ? 6 : 0 }}
        >
          {message.contentText}
          <MessageMeta at={message.at} views={message.viewsCount} override={message.displayTime} />
        </div>
      )}

      {!temTexto && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <MessageMeta at={message.at} views={message.viewsCount} override={message.displayTime} />
        </div>
      )}

      <ReactionsRow reactions={message.reactions} />
    </div>
  );
}
