"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";
import { groupMessages } from "@/lib/social-proof/grouping";
import { moveItem } from "@/lib/social-proof/reorder";
import { formatDaySeparator, isSameDay } from "@/lib/social-proof/format";
import { MessageGroup } from "@/components/telegram/message-group";
import { DateSeparator } from "@/components/telegram/date-separator";

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
  messageBadge,
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
  /**
   * Chip extra por mensagem, desenhado junto da bolha (o status de envio, na
   * campanha agendada). Ausente — que é o caso do Mini App público e da Prova
   * Social — não acrescenta um único nó ao DOM.
   */
  messageBadge?: (id: string) => ReactNode;
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
        // O rascunho ainda não é uma linha do banco: não tem estado de envio
        // pra mostrar, e pedi-lo devolveria o chip da mensagem errada.
        const chip = ehRascunho ? null : messageBadge?.(m.id);

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
            {chip && <div className="tg-feed__badge">{chip}</div>}
          </div>
        );
      })}
    </div>
  );
}
