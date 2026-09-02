import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";
import { groupMessages } from "@/lib/social-proof/grouping";
import { formatDaySeparator, isSameDay } from "@/lib/social-proof/format";
import { MessageGroup } from "@/components/telegram/message-group";
import { DateSeparator } from "@/components/telegram/date-separator";

/**
 * O feed inteiro.
 *
 * `now` vem por parâmetro (não de new Date() aqui dentro) porque a página
 * precisa usar o MESMO instante pra todas as mensagens — offsets resolvidos
 * contra "agoras" diferentes produziriam horários incoerentes entre si.
 */
export function ChannelFeed({
  messages,
  channel,
  now,
}: {
  messages: FeedMessage[];
  channel: FeedChannel;
  now: Date;
}) {
  const grouped = groupMessages(messages, now);

  return (
    <div className="tg-feed" style={{ position: "relative", zIndex: 1 }}>
      {grouped.map((m, i) => {
        const anterior = grouped[i - 1];
        const novoDia = anterior === undefined || !isSameDay(anterior.at, m.at);

        return (
          <div key={m.id}>
            {novoDia && <DateSeparator label={formatDaySeparator(m.at, now)} />}
            <MessageGroup message={m} channel={channel} />
          </div>
        );
      })}
    </div>
  );
}
