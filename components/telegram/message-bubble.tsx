import type { CSSProperties } from "react";
import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { SenderName } from "@/components/telegram/sender-name";
import { MessageMeta, estimateMetaWidth } from "@/components/telegram/message-meta";
import { MediaContainer } from "@/components/telegram/media-container";
import { AlbumGrid } from "@/components/telegram/album-grid";
import { AudioBubble } from "@/components/telegram/audio-bubble";
import { ReplyPreview } from "@/components/telegram/reply-preview";
import { ReactionsRow } from "@/components/telegram/reactions-row";
import { BubbleTail } from "@/components/telegram/icons";
import { resolveSender } from "@/lib/social-proof/sender";

/**
 * A bolha. Sempre alinhada à esquerda — o Mini App simula um canal de
 * terceiros, então nunca existe mensagem "própria" do lead.
 *
 * O selo "admin" fica encostado à direita da linha do nome, como o rótulo de
 * administrador do Telegram. Cantos seguem a posição no grupo: o canto superior
 * esquerdo só é grande na primeira mensagem, o inferior esquerdo só ganha
 * rabinho na última; entre elas os dois ficam pequenos. O selo "admin" fica à
 * direita do nome.
 *
 * A hora vive no canto inferior direito. Um espaçador invisível no fim do
 * texto reserva a largura dela, para a última linha nunca ficar por baixo.
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
  const temReacoes = message.reactions.some((r) => r.count > 0);
  const midiaVisual = temMidia && !ehAudio;

  const classes = [
    "tg-bubble",
    message.isFirstOfGroup ? "" : "tg-bubble--cont-top",
    message.isLastOfGroup ? "tg-bubble--tail" : "tg-bubble--cont-bottom",
    midiaVisual && temTexto ? "tg-bubble--media" : "",
    midiaVisual && !temTexto ? "tg-bubble--media-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const meta = (variant: "corner" | "overlay" | "line") => (
    <MessageMeta at={message.at} views={message.viewsCount} override={message.displayTime} variant={variant} />
  );

  // Sem texto e sem reações, a hora vai sobre a mídia; com reações, ela desce
  // para a linha própria depois delas — é onde o Telegram a põe.
  const metaSobreMidia = midiaVisual && !temTexto && !temReacoes && !ehAlbum;
  const metaNoCanto = temTexto && !temReacoes;
  const metaEmLinha = !metaSobreMidia && !metaNoCanto;

  const spacerStyle = {
    "--tgc-meta-w": `${estimateMetaWidth(message.viewsCount, message.displayTime)}px`,
  } as CSSProperties;

  return (
    <div className={classes}>
      {message.isFirstOfGroup && (
        <div className="tg-bubble__head">
          <SenderName name={sender.name} />
          {sender.badge && <span className="tg-owner-badge">{sender.badge}</span>}
        </div>
      )}

      {temResposta && (
        <ReplyPreview sender={message.replyToSender ?? ""} text={message.replyToText ?? ""} />
      )}

      {ehAlbum && <AlbumGrid media={message.media} />}
      {ehAudio && <AudioBubble item={message.media[0]} seed={message.id} />}
      {midiaVisual && !ehAlbum && (
        <MediaContainer item={message.media[0]} hasCaption={temTexto}>
          {metaSobreMidia && meta("overlay")}
        </MediaContainer>
      )}

      {temTexto && (
        <div className="tg-bubble-text">
          {message.contentText}
          {metaNoCanto && (
            <>
              <span className="tg-meta-spacer" style={spacerStyle} aria-hidden />
              {meta("corner")}
            </>
          )}
        </div>
      )}

      <ReactionsRow reactions={message.reactions} />

      {metaEmLinha && meta("line")}

      {message.isLastOfGroup && <BubbleTail />}
    </div>
  );
}
