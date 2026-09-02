"use client";

import type { SocialProofMessage } from "@/lib/types/database";
import type { FeedMessage } from "@/lib/social-proof/types";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader } from "@/components/telegram/channel-header";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelFooter } from "@/components/telegram/channel-footer";
import "@/components/telegram/theme.css";

function toFeedMessage(m: SocialProofMessage): FeedMessage {
  return {
    id: m.id,
    senderName: m.sender_name,
    senderAvatarUrl: m.sender_avatar_url,
    contentText: m.content_text,
    mediaUrl: m.media_url,
    mediaType: m.media_type,
    offsetSeconds: m.offset_seconds,
    viewsCount: m.views_count,
  };
}

/** A mensagem sendo digitada, mostrada no fim do feed antes de existir no banco. */
function draftToFeedMessage(d: MessageInput): FeedMessage | null {
  const temTexto = (d.content_text ?? "").trim() !== "";
  const temMidia = (d.media_url ?? "").trim() !== "";
  if (!temTexto && !temMidia) return null;

  return {
    id: "__rascunho__",
    senderName: d.sender_name || "Sem nome",
    senderAvatarUrl: d.sender_avatar_url,
    contentText: temTexto ? d.content_text : null,
    mediaUrl: temMidia ? d.media_url : null,
    mediaType: temMidia ? d.media_type : null,
    offsetSeconds: d.offset_seconds,
    viewsCount: d.views_count,
  };
}

/**
 * Preview do Mini App dentro do console.
 *
 * Sem .tg-app--fullscreen: o modificador que fixa na viewport fica só no Mini
 * App real. Aqui a moldura tem altura fixa, como a tela de um celular.
 *
 * `now` é criado a cada render, o que é justamente o certo aqui: mexer no
 * campo "há quantos minutos" tem que mudar a hora exibida na hora.
 */
export function FeedPreview({
  channel,
  messages,
  draft,
}: {
  channel: ChannelInput;
  messages: SocialProofMessage[];
  draft: MessageInput;
}) {
  const rascunho = draftToFeedMessage(draft);
  const lista = [...messages.map(toFeedMessage), ...(rascunho ? [rascunho] : [])];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-(--text-secondary)">
        {channel.is_active
          ? "Prévia — é exatamente isto que o lead vê"
          : "Prévia — o canal está INATIVO"}
      </h2>

      {/* loadFeed filtra .eq("is_active", true) e a coluna nasce `false`: com
          o canal desmarcado o lead não vê nada disto, vê 404. A prévia
          continua visível (é o que o tenant está montando), mas dizer
          "é exatamente isto que o lead vê" aqui seria mentira. */}
      {!channel.is_active && (
        <p className="rounded-lg border border-(--amber) bg-(--amber)/10 px-3 py-2 text-sm text-(--amber)">
          Isto é só a prévia. Com o canal <strong>inativo</strong>, o lead que tocar
          no botão recebe uma página de erro — nada deste feed aparece pra ele.
          Marque <strong>&ldquo;Ativo&rdquo;</strong> na seção Canal e salve pra publicar.
        </p>
      )}

      <div
        className="tg-app overflow-hidden rounded-[28px] border-4 border-(--border-default)"
        style={{ height: 620, maxWidth: 380, position: "relative" }}
      >
        <ChatBackdrop />
        <ChannelHeader
          channel={{
            title: channel.title || "Nome do canal",
            avatarUrl: channel.avatar_url,
            subscribersLabel: channel.subscribers_label || "0 inscritos",
            isVerified: channel.is_verified,
          }}
        />
        <ChannelFeed messages={lista} now={new Date()} />
        <ChannelFooter />
      </div>

      <p className="text-xs text-(--text-muted)">
        O tema aqui é o escuro padrão do Telegram. No celular do lead, as cores vêm
        do tema dele.
      </p>
    </section>
  );
}
