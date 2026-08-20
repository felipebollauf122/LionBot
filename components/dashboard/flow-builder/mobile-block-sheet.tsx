"use client";

import { useEffect, useRef } from "react";
import { NODE_META, NODE_CATEGORIES } from "./flow-utils";

// Mesmos itens da paleta desktop: tudo de NODE_META menos "unmapped",
// que só existe em fluxos clonados e não pode ser criado manualmente.
const sheetItems = Object.entries(NODE_META)
  .filter(([type]) => type !== "unmapped")
  .map(([type, meta]) => ({ type, ...meta }));

/**
 * Bottom sheet de blocos para o MOBILE. No celular não dá pra arrastar (drag) do
 * NodePalette, então aqui o usuário TOCA num bloco e ele é adicionado ao fluxo.
 * Aberto pelo botão "+" flutuante do editor.
 */
export function MobileBlockSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (type: string) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Gestão de foco: ao abrir guarda o elemento ativo e foca o sheet;
  // ao fechar/desmontar devolve o foco pra quem o tinha antes.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  // Escape fecha o sheet enquanto aberto
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="md:hidden fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-block-sheet-title"
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in"
      />
      {/* sheet */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="relative rounded-t-2xl border-t border-(--border-default) max-h-[72vh] overflow-y-auto pb-safe animate-up outline-none"
        style={{ background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)" }}
      >
        {/* grab handle */}
        <div className="sticky top-0 pt-3 pb-2 flex flex-col items-center gap-2 bg-(--bg-elevated)/90 backdrop-blur-md z-10">
          <div className="w-10 h-1 rounded-full bg-white/15" aria-hidden="true" />
          <p id="mobile-block-sheet-title" className="text-foreground font-semibold text-sm">Adicionar bloco</p>
        </div>

        <div className="px-4 pb-4 space-y-4">
          {NODE_CATEGORIES.map((cat) => {
            const items = sheetItems.filter((n) => n.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <p className="text-(--text-secondary) text-[0.6875rem] font-bold uppercase tracking-[0.14em] mb-2">{cat}</p>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => {
                        onPick(item.type);
                        onClose();
                      }}
                      className="flex items-start gap-2.5 px-3 py-3 min-h-11 rounded-xl border border-(--border-subtle) bg-white/2 active:scale-[0.97] active:bg-white/5 transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `color-mix(in srgb, ${item.color} 12%, transparent)` }}
                      >
                        <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d={item.icon} />
                        </svg>
                      </div>
                      <span className="min-w-0 flex flex-col">
                        <span className="text-foreground text-sm font-medium">{item.label}</span>
                        <span className="text-(--text-secondary) text-[0.6875rem] leading-snug">{item.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
