"use client";

import { useState } from "react";
import type { SocialProofMessage } from "@/lib/types/database";
import type {
  ChannelInput,
  FeedChannel,
  FeedMessage,
  MessageInput,
} from "@/lib/social-proof/types";
import { normalizeMedia } from "@/lib/social-proof/media";
import { normalizeReactions } from "@/lib/social-proof/reactions";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader, type TelegramDevice } from "@/components/telegram/channel-header";
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
    reactions: normalizeReactions(m.reactions),
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
  
  // Se está vazio mas é uma resposta a outra mensagem, ou é uma mensagem existente que foi apagada no rascunho,
  // nós retornamos o rascunho para que a bolha (mesmo que vazia ou contendo apenas a citação) apareça
  // na prévia e o usuário tenha o feedback visual.
  if (!temTexto && !temMidia && !d.reply_to_id && !d.id) return null;

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
  selectedId,
  disabled,
  onSelect,
  onReorder,
  onDuplicate,
  onPin,
  onDelete,
}: {
  channel: ChannelInput;
  messages: SocialProofMessage[];
  draft: MessageInput | null;
  pinnedText: string;
  selectedId?: string | null;
  disabled?: boolean;
  onSelect?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onDuplicate?: (id: string) => void;
  onPin?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [device, setDevice] = useState<TelegramDevice>("iphone");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const porId = new Map(messages.map((m) => [m.id, m]));
  const rascunho = draft ? draftToFeedMessage(draft, porId, channel) : null;

  // Editar uma mensagem existente produz um rascunho COM o id dela. Ele precisa
  // SUBSTITUIR a original na posição dela — anexar no fim mostrava a mesma
  // mensagem duas vezes e na ordem errada, embaixo de um título que promete ser
  // exatamente o que o lead vê.
  const lista: FeedMessage[] = messages.map((m) =>
    rascunho && draft?.id === m.id
      ? { ...rascunho, id: m.id }
      : toFeedMessage(m, porId, channel),
  );

  // Rascunho novo (ainda sem id) nasce no fim, que é onde ele apareceria.
  if (rascunho && !draft?.id) lista.push(rascunho);

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
    <section className="tg-preview w-full flex flex-col items-center h-full min-h-0">
      <div className="tg-preview-toolbar">
        <div className="min-w-0">
          <h2 className="tg-preview-toolbar__title">Prévia do canal</h2>
          <p className="tg-preview-toolbar__hint">
            {channel.is_active ? "Atualiza em tempo real enquanto você edita" : "Canal inativo — o lead verá uma página de erro"}
          </p>
        </div>

        <div className="tg-preview-toolbar__controls">
          <div className="tg-preview-segmented" role="group" aria-label="Visão do dispositivo">
            <button type="button" aria-pressed={device === "iphone"} className={device === "iphone" ? "is-active" : ""} onClick={() => setDevice("iphone")}>
              <svg width="15" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M10 5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              iPhone
            </button>
            <button type="button" aria-pressed={device === "android"} className={device === "android" ? "is-active" : ""} onClick={() => setDevice("android")}>
              <svg width="16" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 8h8M8 12h8M9 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Android
            </button>
          </div>
          <div className="tg-preview-theme" role="group" aria-label="Tema da prévia">
            <button type="button" aria-label="Tema claro" aria-pressed={theme === "light"} className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
            <button type="button" aria-label="Tema escuro" aria-pressed={theme === "dark"} className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div
        className={`tg-app tg-app--${device} tg-app--${theme} tg-preview-device w-full relative mx-auto flex flex-col flex-1 min-h-0 ${device === "iphone" ? "tg-preview-device--iphone" : "tg-preview-device--android"}`}
        style={{ maxWidth: device === "iphone" ? 380 : 390 }}
      >
        <ChatBackdrop />
        <ChannelHeader channel={feedChannel} device={device} />
        <PinnedBar text={pinnedText} />
        <ChannelFeed 
          messages={lista} 
          channel={feedChannel} 
          now={new Date()} 
          originalIds={messages.map(m => m.id)} // Pass original IDs so we can reorder them
          selectedId={selectedId}
          disabled={disabled}
          onSelect={onSelect}
          onReorder={onReorder}
          onDuplicate={onDuplicate}
          onPin={onPin}
          onDelete={onDelete}
        />
        <ChannelFooter device={device} />
      </div>
    </section>
  );
}
