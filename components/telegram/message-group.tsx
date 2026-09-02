import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { TgAvatar } from "@/components/telegram/avatar";
import { MessageBubble } from "@/components/telegram/message-bubble";
import { resolveSender } from "@/lib/social-proof/sender";

/**
 * Uma linha do feed: slot de avatar + bolha.
 *
 * O avatar sai de resolveSender, não da mensagem: mensagem da dona usa o avatar
 * do canal, e usar sender_avatar_url aqui mostraria o avatar errado.
 */
export function MessageGroup({
  message,
  channel,
}: {
  message: GroupedMessage;
  channel: FeedChannel;
}) {
  const sender = resolveSender(message, channel);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        marginBottom: message.isLastOfGroup ? 8 : 2,
      }}
    >
      <TgAvatar name={sender.name} url={sender.avatarUrl} visible={message.isLastOfGroup} />
      <MessageBubble message={message} channel={channel} />
    </div>
  );
}
