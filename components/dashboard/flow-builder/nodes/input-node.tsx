"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export function InputNode({ data, selected }: NodeProps) {
  const prompt = String(data.prompt ?? "Pergunta...");
  const variable = String(data.variable ?? "resposta");

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-50 max-w-70 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--purple)" : "color-mix(in srgb, var(--purple) 18%, transparent)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--purple-glow), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--purple)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--purple) 15%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </div>
        <span className="text-(--purple) text-[10px] font-bold uppercase tracking-wider">Input</span>
      </div>
      <p className="text-(--text-secondary) text-sm">{prompt.length > 50 ? prompt.slice(0, 50) + "..." : prompt}</p>
      <p className="text-(--purple) text-[10px] mt-1.5 stat-value" style={{ opacity: 0.6 }}>{`→ {{${variable}}}`}</p>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--purple)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
