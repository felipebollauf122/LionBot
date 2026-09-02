"use client";

import { useState } from "react";
import type { SocialProofMessage } from "@/lib/types/database";
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

      {messages.map((m, i) => (
        <div
          key={m.id}
          draggable
          onDragStart={() => setArrastando(i)}
          onDragEnd={() => setArrastando(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => soltar(i)}
          onClick={() => onSelect(m.id)}
          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${
            selectedId === m.id
              ? "border-(--accent) bg-(--accent-deep)"
              : "border-(--border-subtle) hover:bg-(--bg-hover)"
          }`}
        >
          <span className="w-4 text-center text-xs text-(--text-ghost)">{i + 1}</span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-(--text-primary)">
              {m.sender_kind === "owner" ? "Dona" : m.sender_name || "Membro"}
              <span className="text-(--text-muted)"> · {ROTULO_TIPO[m.kind] ?? m.kind}</span>
              {pinnedId === m.id && <span className="ml-2 text-xs text-(--amber)">fixada</span>}
            </p>
            <p className="text-xs text-(--text-muted)">
              há {Math.round(m.offset_seconds / 60)} min
            </p>
          </div>

          <span className="text-xs text-(--text-muted)">{m.views_count}</span>

          {/* Menu da linha. As mesmas ações existem no editor, mas agir direto
              na linha — sem precisar selecionar antes — é o caminho rápido, e
              é o que o mockup mostra. */}
          <div className="relative">
            <button
              type="button"
              aria-label="Ações da mensagem"
              onClick={(e) => {
                e.stopPropagation();
                setMenuAberto(menuAberto === m.id ? null : m.id);
              }}
              className="px-1 text-(--text-muted) hover:text-(--text-primary)"
            >
              ⋮
            </button>

            {menuAberto === m.id && (
              <>
                {/* Camada invisível que fecha o menu no primeiro clique fora.
                    Sem ela o menu, que é absoluto e tem ~120px, cobre 1 ou 2
                    linhas abaixo: um clique mirando a linha coberta pode
                    acertar "Excluir" de OUTRA mensagem. */}
                <div
                  className="fixed inset-0 z-20"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuAberto(null);
                  }}
                />

                <div
                  className="absolute right-0 top-6 z-30 w-36 overflow-hidden rounded-lg border border-(--border-default) bg-(--bg-overlay)"
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
                      onClick={() => {
                        setMenuAberto(null);
                        op.acao();
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-(--bg-hover) ${
                        op.perigo ? "text-(--red)" : "text-(--text-secondary)"
                      }`}
                    >
                      {op.rotulo}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ))}

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
