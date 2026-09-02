import type { GroupedMessage } from "@/lib/social-proof/types";
import { TgAvatar } from "@/components/telegram/avatar";
import { MessageBubble } from "@/components/telegram/message-bubble";

/**
 * Uma linha do feed: slot de avatar + bolha.
 *
 * O avatar só é visível na última mensagem do grupo, mas o slot existe sempre —
 * é ele que mantém o bloco alinhado. Espaçamento menor dentro do grupo (2px)
 * que entre grupos (8px), como no Telegram.
 */
export function MessageGroup({ message }: { message: GroupedMessage }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        marginBottom: message.isLastOfGroup ? 8 : 2,
      }}
    >
      <TgAvatar
        name={message.senderName}
        url={message.senderAvatarUrl}
        visible={message.isLastOfGroup}
      />
      <MessageBubble message={message} />
    </div>
  );
}
