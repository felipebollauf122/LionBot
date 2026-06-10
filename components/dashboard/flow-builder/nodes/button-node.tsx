"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ButtonData { text: string; action: string; value: string; }

export function ButtonNode({ data, selected }: NodeProps) {
  const text = String(data.text ?? "Mensagem com botoes");
  const buttons = (data.buttons ?? []) as ButtonData[];

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-50 max-w-70 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--cyan)" : "color-mix(in srgb, var(--cyan) 15%, transparent)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--cyan-glow), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--cyan) 15%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
          </svg>
        </div>
        <span className="text-(--cyan) text-[10px] font-bold uppercase tracking-wider">Botoes</span>
      </div>
      <p className="text-(--text-secondary) text-sm mb-2">{text.length > 40 ? text.slice(0, 40) + "..." : text}</p>
      <div className="space-y-1">
        {buttons.map((btn, i) => (
          <div
            key={i}
            className="rounded-lg px-2.5 py-1.5 text-xs text-center font-medium"
            style={{
              background: "color-mix(in srgb, var(--cyan) 6%, transparent)",
              border: "1px solid color-mix(in srgb, var(--cyan) 10%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            {btn.text}
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
