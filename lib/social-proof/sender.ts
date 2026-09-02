import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

export interface ResolvedSender {
  name: string;
  avatarUrl: string | null;
  /** "Dona do canal" quando a mensagem é da dona; null para membro. */
  badge: string | null;
}

const SELO_DONA = "Dona do canal";

/**
 * Decide quem aparece enviando a mensagem.
 *
 * A dona é uma identidade do CANAL, não da mensagem: no mockup o canal é
 * "teste" com avatar de lobo e a dona é "Daniel" com avatar próprio. Por isso
 * mensagens com sender_kind "owner" ignoram sender_name/sender_avatar_url —
 * elas existem só para os membros.
 *
 * Os fallbacks evitam bolha com nome vazio, que chama mais atenção que um nome
 * genérico.
 */
export function resolveSender(message: FeedMessage, channel: FeedChannel): ResolvedSender {
  if (message.senderKind === "owner") {
    const nome = channel.ownerName.trim() || channel.title.trim() || "Canal";
    return { name: nome, avatarUrl: channel.ownerAvatarUrl, badge: SELO_DONA };
  }

  return {
    name: message.senderName.trim() || "Membro",
    avatarUrl: message.senderAvatarUrl,
    badge: null,
  };
}
