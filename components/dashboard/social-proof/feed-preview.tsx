"use client";

import type { SocialProofMessage } from "@/lib/types/database";
import type {
  ChannelInput,
  FeedChannel,
  FeedMessage,
  MessageInput,
} from "@/lib/social-proof/types";
import { normalizeMedia } from "@/lib/social-proof/media";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader } from "@/components/telegram/channel-header";
import { PinnedBar } from "@/components/telegram/pinned-bar";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelFooter } from "@/components/telegram/channel-footer";
import "@/components/telegram/theme.css";

/** Resolve a citação contra as mensagens já carregadas, como lib/social-proof/feed.ts faz. */
function resolverCitacao(
  m: SocialProofMessage,
  porId: Map<string, SocialProofMessage>,
  channel: ChannelInput,
): { replyToText: string | null; replyToSender: string | null } {
  const alvo = m.reply_to_id ? porId.get(m.reply_to_id) : undefined;
  if (!alvo) return { replyToText: null, replyToSender: null };

  return {
    replyToText: alvo.content_text,
    replyToSender:
      alvo.sender_kind === "owner"
        ? channel.owner_name || channel.title
        : alvo.sender_name,
  };
}

function toFeedMessage(
  m: SocialProofMessage,
  porId: Map<string, SocialProofMessage>,
  channel: ChannelInput,
): FeedMessage {
  return {
    id: m.id,
    senderKind: m.sender_kind === "owner" ? "owner" : "member",
    senderName: m.sender_name,
    senderAvatarUrl: m.sender_avatar_url,
    kind: m.kind as FeedMessage["kind"],
    contentText: m.content_text,
    media: normalizeMedia(m.media, m.media_url, m.media_type),
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
    ...resolverCitacao(m, porId, channel),
    offsetSeconds: m.offset_seconds,
    displayTime: m.display_time,
    viewsCount: m.views_count,
  };
}

function draftToFeedMessage(
  d: MessageInput,
  porId: Map<string, SocialProofMessage>,
  channel: ChannelInput,
): FeedMessage | null {
  const temTexto = (d.content_text ?? "").trim() !== "";
  const temMidia = d.media.length > 0;
  if (!temTexto && !temMidia) return null;

  // Mesma resolução de resolverCitacao, mas a partir do rascunho: é
  // justamente a mensagem criada por "Responder" que precisa mostrar a
  // citação antes de existir no banco.
  const alvo = d.reply_to_id ? porId.get(d.reply_to_id) : undefined;

  return {
    id: "__rascunho__",
    senderKind: d.sender_kind,
    senderName: d.sender_name || "Sem nome",
    senderAvatarUrl: d.sender_avatar_url,
    kind: d.kind,
    contentText: temTexto ? d.content_text : null,
    media: d.media,
    reactions: d.reactions,
    replyToText: alvo ? alvo.content_text : null,
    replyToSender: alvo
      ? alvo.sender_kind === "owner"
        ? channel.owner_name || channel.title
        : alvo.sender_name
      : null,
    offsetSeconds: d.offset_seconds,
    displayTime: d.display_time,
    viewsCount: d.views_count,
  };
}

export function FeedPreview({
  channel,
  messages,
  draft,
  pinnedText,
}: {
  channel: ChannelInput;
  messages: SocialProofMessage[];
  draft: MessageInput | null;
  pinnedText: string;
}) {
  const porId = new Map(messages.map((m) => [m.id, m]));
  const rascunho = draft ? draftToFeedMessage(draft, porId, channel) : null;
  const lista = [
    ...messages.map((m) => toFeedMessage(m, porId, channel)),
    ...(rascunho ? [rascunho] : []),
  ];

  const feedChannel: FeedChannel = {
    title: channel.title || "Nome do canal",
    avatarUrl: channel.avatar_url,
    subscribersLabel: channel.subscribers_label || "0 inscritos",
    isVerified: channel.is_verified,
    ownerName: channel.owner_name,
    ownerAvatarUrl: channel.owner_avatar_url,
    ownerUsername: channel.owner_username,
    unreadBadge: channel.unread_badge,
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-(--text-secondary)">
        {channel.is_active
          ? "Prévia — é exatamente isto que o lead vê"
          : "Prévia — o canal está INATIVO; o lead verá uma página de erro"}
      </h2>

      <div
        className="tg-app overflow-hidden rounded-[28px] border-4 border-(--border-default)"
        style={{ height: 620, maxWidth: 380, position: "relative" }}
      >
        <ChatBackdrop />
        <ChannelHeader channel={feedChannel} />
        <PinnedBar text={pinnedText} />
        <ChannelFeed messages={lista} channel={feedChannel} now={new Date()} />
        <ChannelFooter />
      </div>
    </section>
  );
}
