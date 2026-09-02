/** Um item de mídia. `album` tem vários; `audio` guarda a duração aqui. */
export interface MediaItem {
  url: string;
  type: "photo" | "video" | "audio";
  durationSeconds?: number;
}

/** Uma reação com contador, como o Telegram mostra sob a bolha. */
export interface Reaction {
  emoji: string;
  count: number;
}

/** Quem aparece enviando: a dona do canal ou um membro qualquer. */
export type SenderKind = "owner" | "member";

/** Os cinco botões de "Tipo de mensagem" do editor. */
export type MessageKind = "text" | "photo" | "video" | "audio" | "album";

/** O que o Mini App precisa saber sobre o canal simulado. */
export interface FeedChannel {
  title: string;
  avatarUrl: string | null;
  subscribersLabel: string;
  isVerified: boolean;
  /** Identidade da dona — separada do canal (o canal pode ter outro avatar). */
  ownerName: string;
  ownerAvatarUrl: string | null;
  ownerUsername: string;
  /** Contador de não lidas no canto do cabeçalho. 0 esconde o badge. */
  unreadBadge: number;
}

/** Uma mensagem do feed, já sem os campos internos do banco. */
export interface FeedMessage {
  id: string;
  senderKind: SenderKind;
  /** Só usado quando senderKind === "member". */
  senderName: string;
  senderAvatarUrl: string | null;
  kind: MessageKind;
  contentText: string | null;
  media: MediaItem[];
  reactions: Reaction[];
  /** Texto da mensagem respondida, já resolvido pelo servidor. */
  replyToText: string | null;
  replyToSender: string | null;
  /** Há quantos segundos a mensagem "aconteceu", contado do agora do lead. */
  offsetSeconds: number;
  /** "HH:MM" fixo. Quando presente, sobrepõe o horário calculado do offset. */
  displayTime: string | null;
  viewsCount: number;
}

/** FeedMessage com as flags de posição no grupo, produzidas por groupMessages(). */
export interface GroupedMessage extends FeedMessage {
  isFirstOfGroup: boolean;
  isLastOfGroup: boolean;
  /** Data absoluta já resolvida a partir do offset. */
  at: Date;
}

/*
 * Tipos de entrada e retorno das Server Actions do composer.
 *
 * Moram aqui e não no arquivo de actions porque um módulo "use server" só pode
 * exportar funções async — tipo exportado de lá é aposta em o transform apagar
 * a declaração antes da checagem. Aqui não há aposta nenhuma.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface ChannelInput {
  title: string;
  avatar_url: string | null;
  subscribers_label: string;
  is_verified: boolean;
  is_active: boolean;
  owner_name: string;
  owner_avatar_url: string | null;
  owner_username: string;
  unread_badge: number;
}

export interface MessageInput {
  id?: string;
  sender_kind: SenderKind;
  sender_name: string;
  sender_avatar_url: string | null;
  kind: MessageKind;
  content_text: string | null;
  media: MediaItem[];
  reactions: Reaction[];
  reply_to_id: string | null;
  display_time: string | null;
  offset_seconds: number;
  views_count: number;
  // `position` NÃO entra aqui: quem calcula é a Server Action (max+1).
}
