"use client";

import { useState } from "react";
import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { MessageBubble } from "@/components/telegram/message-bubble";
import { ShareArrowIcon } from "@/components/telegram/icons";
import { motion, AnimatePresence } from "motion/react";

/**
 * Uma linha do feed: a bolha e, à direita, o botão redondo de encaminhar que
 * o Telegram põe ao lado de toda publicação de canal. Sem coluna de avatar —
 * canal não mostra avatar por mensagem, e é isso que as prints têm.
 */
export function MessageGroup({
  message,
  channel,
  selected,
  disabled,
  isDraft,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onClick,
  onDuplicate,
  onPin,
  onDelete,
}: {
  message: GroupedMessage;
  channel: FeedChannel;
  selected?: boolean;
  disabled?: boolean;
  isDraft?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onClick?: () => void;
  onDuplicate?: () => void;
  onPin?: () => void;
  onDelete?: () => void;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  const classes = [
    "tg-row",
    message.isLastOfGroup ? "tg-row--group-end" : "",
    selected ? "tg-row--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className={classes}
      style={{
        cursor: isDraft ? "default" : onClick ? "pointer" : "default",
        opacity: isDraft ? 0.7 : 1,
      }}
    >
      <div
        className="tg-row__bubble-col"
        // pointer-events-none so quando a LINHA e clicavel (console). No Mini App
        // publico nao ha onClick, e desabilitar o ponteiro aqui matava os
        // controles de video da bolha para o lead.
        style={{ pointerEvents: onClick ? "none" : undefined }}
      >
        <MessageBubble message={message} channel={channel} />
      </div>

      <span className="tg-share" aria-hidden>
        <ShareArrowIcon width={14} height={12} />
      </span>

      {!isDraft && (onDuplicate || onPin || onDelete) && (
        <div className="tg-row__actions">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              setMenuAberto(!menuAberto);
            }}
            className="p-1.5 rounded-full backdrop-blur-md"
            style={{ background: "var(--tgc-service)", color: "var(--tgc-service-text)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>

          <AnimatePresence>
            {menuAberto && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuAberto(false);
                  }}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-8 z-30 w-36 overflow-hidden rounded-lg border shadow-xl"
                  style={{ background: "var(--tgc-menu-bg)", borderColor: "var(--tgc-menu-border)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {onDuplicate && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAberto(false);
                        onDuplicate();
                      }}
                      className="block w-full px-3 py-2 text-left text-sm"
                      style={{ color: "var(--tgc-text)" }}
                    >
                      Duplicar
                    </button>
                  )}
                  {onPin && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAberto(false);
                        onPin();
                      }}
                      className="block w-full px-3 py-2 text-left text-sm"
                      style={{ color: "var(--tgc-text)" }}
                    >
                      Fixar / Desafixar
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAberto(false);
                        onDelete();
                      }}
                      className="block w-full px-3 py-2 text-left text-sm"
                      style={{ color: "var(--tgc-danger)" }}
                    >
                      Excluir
                    </button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
