"use client";

import { paletteNodeTypes, paletteCategories } from "./node-palette";

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
  if (!open) return null;
  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal>
      {/* backdrop */}
      <button
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in"
      />
      {/* sheet */}
      <div
        className="relative rounded-t-2xl border-t border-(--border-default) max-h-[72vh] overflow-y-auto pb-safe animate-up"
        style={{ background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)" }}
      >
        {/* grab handle */}
        <div className="sticky top-0 pt-3 pb-2 flex flex-col items-center gap-2 bg-(--bg-elevated)/90 backdrop-blur-md z-10">
          <div className="w-10 h-1 rounded-full bg-white/15" />
          <p className="text-foreground font-semibold text-sm">Adicionar bloco</p>
        </div>

        <div className="px-4 pb-4 space-y-4">
          {paletteCategories.map((cat) => {
            const items = paletteNodeTypes.filter((n) => n.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <p className="text-(--text-ghost) text-[10px] font-bold uppercase tracking-[0.14em] mb-2">{cat}</p>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item) => (
                    <button
                      key={item.type}
                      onClick={() => {
                        onPick(item.type);
                        onClose();
                      }}
                      className="flex items-center gap-2.5 px-3 py-3 rounded-xl border border-(--border-subtle) bg-white/[0.02] active:scale-[0.97] active:bg-white/5 transition-all text-left"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `color-mix(in srgb, ${item.color} 12%, transparent)` }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d={item.icon} />
                        </svg>
                      </div>
                      <span className="text-(--text-secondary) text-sm font-medium">{item.label}</span>
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
