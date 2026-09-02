import { useState } from "react";
import type { FeedChannel, GroupedMessage } from "@/lib/social-proof/types";
import { TgAvatar } from "@/components/telegram/avatar";
import { MessageBubble } from "@/components/telegram/message-bubble";
import { resolveSender } from "@/lib/social-proof/sender";
import { motion, AnimatePresence } from "motion/react";

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
  const sender = resolveSender(message, channel);
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      className={`relative group ${selected ? "bg-[var(--tgc-accent)]/10" : "hover:bg-black/20"} transition-colors`}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        padding: "4px 8px",
        marginBottom: message.isLastOfGroup ? 8 : 2,
        cursor: isDraft ? "default" : "pointer",
        opacity: isDraft ? 0.7 : 1,
      }}
    >
      <TgAvatar name={sender.name} url={sender.avatarUrl} visible={message.isLastOfGroup} />
      <div className="flex-1 min-w-0 pointer-events-none">
        <MessageBubble message={message} channel={channel} />
      </div>

      {!isDraft && (onDuplicate || onPin || onDelete) && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              setMenuAberto(!menuAberto);
            }}
            className="p-1.5 rounded-full bg-black/50 text-white hover:bg-black/80 backdrop-blur-md"
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
                  className="absolute right-0 top-8 z-30 w-36 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl"
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
                      className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                      className="block w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
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
                      className="block w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300"
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
