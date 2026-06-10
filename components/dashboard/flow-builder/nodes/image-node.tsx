"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export function ImageNode({ data, selected }: NodeProps) {
  const caption = data.caption ? String(data.caption) : "Sem legenda";

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-45 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--cyan)" : "rgba(0,229,255,0.15)"}`,
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
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <span className="text-(--cyan) text-[10px] font-bold uppercase tracking-wider">Imagem</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--cyan) 8%, transparent)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <p className="text-(--text-secondary) text-sm">{caption}</p>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
