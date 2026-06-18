"use client";

import type { DragEvent } from "react";

export interface NodeTypeItem {
  type: string;
  label: string;
  icon: string;
  color: string;
  category: string;
}

export const paletteNodeTypes: NodeTypeItem[] = [
  { type: "trigger", label: "Gatilho", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", color: "var(--accent)", category: "Inicio" },
  { type: "text", label: "Texto", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", color: "var(--cyan)", category: "Mensagens" },
  { type: "image", label: "Imagem", icon: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z", color: "var(--cyan)", category: "Mensagens" },
  { type: "video", label: "Video", icon: "M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z", color: "var(--cyan)", category: "Mensagens" },
  { type: "button", label: "Botoes", icon: "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18", color: "var(--cyan)", category: "Mensagens" },
  { type: "input", label: "Input", icon: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z", color: "var(--purple)", category: "Mensagens" },
  { type: "delay", label: "Delay", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2", color: "var(--text-secondary)", category: "Logica" },
  { type: "condition", label: "Condicao", icon: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5", color: "var(--amber)", category: "Logica" },
  { type: "action", label: "Acao", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", color: "var(--text-secondary)", category: "Acoes" },
  { type: "payment_button", label: "Pagamento", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--amber)", category: "Pagamento" },
];

export const paletteCategories = ["Inicio", "Mensagens", "Logica", "Acoes", "Pagamento"];

function onDragStart(event: DragEvent, nodeType: string) {
  event.dataTransfer.setData("application/reactflow", nodeType);
  event.dataTransfer.effectAllowed = "move";
}

export function NodePalette() {
  return (
    <div
      className="w-56 overflow-y-auto relative hidden md:flex flex-col"
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <span className="text-foreground font-semibold text-xs tracking-tight">Componentes</span>
        </div>
        {/* Separator */}
        <div className="absolute bottom-0 left-3 right-3 h-px bg-linear-to-r from-transparent via-(--border-default) to-transparent" />
      </div>

      {/* Categories */}
      <div className="flex-1 px-3 pt-3 pb-4 space-y-4">
        {paletteCategories.map((cat) => {
          const items = paletteNodeTypes.filter((n) => n.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-(--text-ghost) text-[10px] font-bold uppercase tracking-[0.14em] px-1.5 mb-2">{cat}</p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, item.type)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-grab active:cursor-grabbing transition-all hover:bg-white/5 group"
                  >
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all"
                      style={{
                        background: `color-mix(in srgb, ${item.color} 10%, transparent)`,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={item.icon} />
                      </svg>
                    </div>
                    <span className="text-(--text-secondary) text-xs font-medium group-hover:text-foreground transition-colors">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
