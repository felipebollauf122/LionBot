import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

export interface ResolvedSender {
  name: string;
  avatarUrl: string | null;
  /** "admin" quando a mensagem é da identidade administradora; null para membro. */
  badge: string | null;
}

const SELO_ADMIN = "admin";

/**
 * Decide quem aparece enviando a mensagem.
 *
 * O admin é uma identidade do CANAL, não da mensagem: o canal pode ter um
 * avatar diferente da identidade administradora. Por isso
 * mensagens com sender_kind "owner" ignoram sender_name/sender_avatar_url —
 * elas existem só para os membros.
 *
 * Os fallbacks evitam bolha com nome vazio, que chama mais atenção que um nome
 * genérico.
 */
export function resolveSender(message: FeedMessage, channel: FeedChannel): ResolvedSender {
  if (message.senderKind === "owner") {
    const nome = channel.ownerName.trim() || channel.title.trim() || "Canal";
    return { name: nome, avatarUrl: channel.ownerAvatarUrl, badge: SELO_ADMIN };
  }

  return {
    name: message.senderName.trim() || "Membro",
    avatarUrl: message.senderAvatarUrl,
    badge: null,
  };
}
