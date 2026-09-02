import { useState } from "react";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";
import { groupMessages } from "@/lib/social-proof/grouping";
import { formatDaySeparator, isSameDay } from "@/lib/social-proof/format";
import { MessageGroup } from "@/components/telegram/message-group";
import { DateSeparator } from "@/components/telegram/date-separator";

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const copia = [...arr];
  const [removido] = copia.splice(from, 1);
  copia.splice(to, 0, removido);
  return copia;
}

export function ChannelFeed({
  messages,
  channel,
  now,
  originalIds = [],
  selectedId,
  disabled,
  onSelect,
  onReorder,
  onDuplicate,
  onPin,
  onDelete,
}: {
  messages: FeedMessage[];
  channel: FeedChannel;
  now: Date;
  originalIds?: string[];
  selectedId?: string | null;
  disabled?: boolean;
  onSelect?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onDuplicate?: (id: string) => void;
  onPin?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const grouped = groupMessages(messages, now);
  const [arrastandoId, setArrastandoId] = useState<string | null>(null);

  function soltar(idDestino: string) {
    if (!arrastandoId || !onReorder || arrastandoId === idDestino) return;
    
    // We only reorder original messages. Ignore drafts.
    const fromIndex = originalIds.indexOf(arrastandoId);
    const toIndex = originalIds.indexOf(idDestino);
    
    if (fromIndex >= 0 && toIndex >= 0) {
      const nova = moveItem(originalIds, fromIndex, toIndex);
      onReorder(nova);
    }
    setArrastandoId(null);
  }

  return (
    <div className="tg-feed" style={{ position: "relative", zIndex: 1 }}>
      {grouped.map((m, i) => {
        const anterior = grouped[i - 1];
        const novoDia = anterior === undefined || !isSameDay(anterior.at, m.at);
        const ehRascunho = m.id === "__rascunho__";

        return (
          <div key={m.id}>
            {novoDia && <DateSeparator label={formatDaySeparator(m.at, now)} />}
            <MessageGroup 
              message={m} 
              channel={channel}
              selected={m.id === selectedId}
              disabled={disabled}
              isDraft={ehRascunho}
              draggable={!ehRascunho && !disabled && !!onReorder}
              onDragStart={() => setArrastandoId(m.id)}
              onDragEnd={() => setArrastandoId(null)}
              onDragOver={(e) => {
                if (arrastandoId && !ehRascunho) e.preventDefault();
              }}
              onDrop={() => soltar(m.id)}
              onClick={() => {
                if (!ehRascunho && onSelect) onSelect(m.id);
              }}
              onDuplicate={onDuplicate ? () => onDuplicate(m.id) : undefined}
              onPin={onPin ? () => onPin(m.id) : undefined}
              onDelete={onDelete ? () => onDelete(m.id) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
