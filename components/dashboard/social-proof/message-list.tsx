"use client";

import { useState } from "react";
import type { SocialProofMessage } from "@/lib/types/database";
import { motion, AnimatePresence } from "motion/react";
import { moveItem } from "@/lib/social-proof/reorder";

const ROTULO_TIPO: Record<string, string> = {
  text: "Texto",
  photo: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  album: "Álbum",
};

/**
 * Lista reordenável do feed.
 *
 * Arrastar usa eventos nativos de HTML5, sem dependência nova: a lista é curta
 * e o gesto é simples o bastante pra não justificar uma biblioteca.
 */
export function MessageList({
  messages,
  selectedId,
  pinnedId,
  disabled,
  onSelect,
  onReorder,
  onDuplicate,
  onPin,
  onDelete,
  onNew,
}: {
  messages: SocialProofMessage[];
  selectedId: string | null;
  pinnedId: string | null;
  /**
   * Verdadeiro durante qualquer Server Action em andamento no composer
   * (salvar, apagar, etc). Trava o ⋮ e o menu pra impedir uma segunda ação na
   * MESMA linha antes da primeira terminar — mesma proteção contra ação
   * concorrente que a v1 tinha só no botão de apagar.
   */
  disabled: boolean;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onDuplicate: (id: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);

  function soltar(destino: number) {
    if (arrastando === null) return;

    const nova = moveItem(messages, arrastando, destino);
    const mudou = nova.some((m, i) => m.id !== messages[i].id);
    setArrastando(null);

    // moveItem devolve a lista intacta quando from === to ou o índice é
    // inválido. Sem esta checagem, largar a mensagem no mesmo lugar gravaria
    // no banco à toa.
    if (mudou) onReorder(nova.map((m) => m.id));
  }

  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
          Mensagens
        </h2>
        <span className="text-xs text-(--text-ghost)">Arraste para reordenar</span>
      </div>

      {messages.length === 0 && (
        <p className="py-4 text-center text-sm text-(--text-muted)">Nenhuma mensagem ainda.</p>
      )}

      <AnimatePresence mode="popLayout">
        {messages.map((m, i) => (
          <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            key={m.id}
            draggable
            onDragStart={() => setArrastando(i)}
            onDragEnd={() => setArrastando(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => soltar(i)}
            onClick={() => onSelect(m.id)}
            className={`relative flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors group ${
              selectedId === m.id
                ? "border-(--accent) bg-(--accent-deep)"
                : "border-(--border-subtle) hover:bg-(--bg-hover) hover:border-(--border-default)"
            }`}
          >
            <div className="flex flex-col items-center justify-center w-6">
              <span className={`text-xs ${selectedId === m.id ? "text-(--accent)" : "text-(--text-ghost) group-hover:hidden"}`}>{i + 1}</span>
              <svg className={`hidden w-4 h-4 text-(--text-muted) group-hover:block ${selectedId === m.id ? "hidden group-hover:hidden" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-(--text-primary)">
                {m.sender_kind === "owner" ? "Dona" : m.sender_name || "Membro"}
                <span className="text-(--text-muted)"> · {ROTULO_TIPO[m.kind] ?? m.kind}</span>
                {pinnedId === m.id && <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold rounded bg-(--amber-muted) text-(--amber) px-1.5 py-0.5">fixada</span>}
              </p>
              <p className="text-xs text-(--text-muted)">
                há {Math.round(m.offset_seconds / 60)} min
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-(--text-muted)">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              {m.views_count}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Ações da mensagem"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuAberto(menuAberto === m.id ? null : m.id);
                }}
                className={`p-1.5 rounded-md disabled:opacity-50 transition-colors ${menuAberto === m.id ? "bg-(--bg-overlay) text-(--text-primary)" : "text-(--text-muted) hover:text-(--text-primary) hover:bg-(--bg-overlay)"}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              </button>

              <AnimatePresence>
                {menuAberto === m.id && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAberto(null);
                      }}
                    />

                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -5 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -5 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-8 z-30 w-36 overflow-hidden rounded-lg border border-(--border-default) bg-(--bg-overlay) shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(
                        [
                          { rotulo: "Duplicar", acao: () => onDuplicate(m.id), perigo: false },
                          {
                            rotulo: pinnedId === m.id ? "Desafixar" : "Fixar",
                            acao: () => onPin(m.id),
                            perigo: false,
                          },
                          { rotulo: "Excluir", acao: () => onDelete(m.id), perigo: true },
                        ] as const
                      ).map((op) => (
                        <button
                          key={op.rotulo}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setMenuAberto(null);
                            op.acao();
                          }}
                          className={`block w-full px-3 py-2 text-left text-sm hover:bg-(--bg-hover) disabled:opacity-50 transition-colors ${
                            op.perigo ? "text-(--red) hover:text-(--red)" : "text-(--text-secondary) hover:text-(--text-primary)"
                          }`}
                        >
                          {op.rotulo}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <button
        type="button"
        onClick={onNew}
        className="w-full rounded-lg border border-dashed border-(--border-default) py-2 text-sm text-(--text-secondary) hover:border-(--accent) hover:text-(--text-primary)"
      >
        + Nova mensagem
      </button>
    </section>
  );
}
