"use client";

import type { DragEvent } from "react";
import { NODE_META, NODE_CATEGORIES } from "./flow-utils";

// Itens adicionáveis pela paleta: tudo de NODE_META menos "unmapped",
// que só existe em fluxos clonados e não pode ser criado manualmente.
const paletteItems = Object.entries(NODE_META)
  .filter(([type]) => type !== "unmapped")
  .map(([type, meta]) => ({ type, ...meta }));

function onDragStart(event: DragEvent, nodeType: string) {
  event.dataTransfer.setData("application/reactflow", nodeType);
  event.dataTransfer.effectAllowed = "move";
}

export function NodePalette({ onAdd }: { onAdd?: (type: string) => void }) {
  return (
    <div
      className="w-64 overflow-y-auto relative hidden md:flex flex-col"
      style={{
        background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)",
        borderRight: "1px solid var(--border-subtle)",
      }}
    >
      {/* Ambient glow */}
      <div className="absolute top-0 left-0 right-0 h-20 bg-linear-to-b from-(--cyan)/4 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="px-4 pt-4 pb-3 relative">
        <div className="flex items-center gap-2.5 mb-1">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--cyan) 12%, transparent)", boxShadow: "0 0 10px -4px var(--cyan)" }}
          >
            <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <span className="text-foreground font-semibold text-xs tracking-tight">Componentes</span>
        </div>
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug">Arraste ou clique para adicionar</p>
        {/* Separator */}
        <div className="absolute bottom-0 left-3 right-3 h-px bg-linear-to-r from-transparent via-(--border-default) to-transparent" />
      </div>

      {/* Categorias */}
      <div className="flex-1 px-3 pt-3 pb-4 space-y-4">
        {NODE_CATEGORIES.map((cat) => {
          const items = paletteItems.filter((n) => n.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-(--text-secondary) text-[0.6875rem] font-bold uppercase tracking-[0.14em] px-1.5 mb-2">{cat}</p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    draggable
                    onDragStart={(e) => onDragStart(e, item.type)}
                    onClick={() => onAdd?.(item.type)}
                    title={item.description}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left cursor-grab active:cursor-grabbing transition-all hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) group"
                  >
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-all"
                      style={{
                        background: `color-mix(in srgb, ${item.color} 10%, transparent)`,
                      }}
                    >
                      <svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={item.icon} />
                      </svg>
                    </div>
                    <span className="min-w-0 flex flex-col">
                      <span className="text-foreground text-xs font-medium">{item.label}</span>
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
  );
}
