/** O que o Mini App precisa saber sobre o canal simulado. */
export interface FeedChannel {
  title: string;
  avatarUrl: string | null;
  subscribersLabel: string;
  isVerified: boolean;
}

/** Uma mensagem do feed, já sem os campos internos do banco. */
export interface FeedMessage {
  id: string;
  senderName: string;
  senderAvatarUrl: string | null;
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  /** Há quantos segundos a mensagem "aconteceu", contado do agora do lead. */
  offsetSeconds: number;
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
}

export interface MessageInput {
  id?: string;
  sender_name: string;
  sender_avatar_url: string | null;
  content_text: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  offset_seconds: number;
  views_count: number;
  // `position` NÃO entra aqui de propósito: quem calcula é a Server Action
  // (max+1 do canal). Vindo do cliente ela colidia — ver lib/social-proof/position.ts.
}
