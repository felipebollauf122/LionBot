"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export function VideoNode({ data, selected }: NodeProps) {
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
            <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        </div>
        <span className="text-(--cyan) text-[10px] font-bold uppercase tracking-wider">Video</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--cyan) 8%, transparent)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
        <p className="text-(--text-secondary) text-sm">{caption}</p>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
