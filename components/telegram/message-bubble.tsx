import type { GroupedMessage } from "@/lib/social-proof/types";
import { SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { MediaContainer } from "@/components/telegram/media-container";

/**
 * A bolha. Sempre alinhada à esquerda — o Mini App simula um canal de
 * terceiros, então nunca existe mensagem "própria" do lead.
 *
 * O rabinho (canto inferior esquerdo reto) aparece só na última mensagem do
 * grupo, como no Telegram.
 */
export function MessageBubble({ message }: { message: GroupedMessage }) {
  const temMidia = message.mediaUrl !== null && message.mediaType !== null;
  const temTexto = message.contentText !== null && message.contentText.trim() !== "";

  const classes = [
    "tg-bubble",
    message.isLastOfGroup ? "tg-bubble--tail" : "",
    temMidia && temTexto ? "tg-bubble--media" : "",
    temMidia && !temTexto ? "tg-bubble--media-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {message.isFirstOfGroup && <SenderName name={message.senderName} />}

      {temMidia && (
        <MediaContainer
          url={message.mediaUrl!}
          type={message.mediaType!}
          hasCaption={temTexto}
        />
      )}

      {temTexto && (
        <div className="tg-bubble-text" style={{ whiteSpace: "pre-wrap", marginTop: temMidia ? 6 : 0 }}>
          {message.contentText}
          <MessageMeta at={message.at} views={message.viewsCount} />
        </div>
      )}

      {!temTexto && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <MessageMeta at={message.at} views={message.viewsCount} />
        </div>
      )}
    </div>
  );
}
