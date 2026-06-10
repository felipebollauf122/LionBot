"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export function ConditionNode({ data, selected }: NodeProps) {
  const field = String(data.field ?? "campo");
  const operator = String(data.operator ?? "equals");
  const value = String(data.value ?? "");
  const opLabel: Record<string, string> = { equals: "=", not_equals: "!=", exists: "existe", not_exists: "nao existe", contains: "contem", greater_than: ">", less_than: "<" };

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-50 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--amber)" : "rgba(255,184,0,0.18)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--amber-glow), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--amber)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--amber) 15%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
        </div>
        <span className="text-(--amber) text-[10px] font-bold uppercase tracking-wider">Condicao</span>
      </div>
      <p className="text-(--text-secondary) text-sm">{field} <span className="text-(--amber) font-medium stat-value">{opLabel[operator] ?? operator}</span> {value}</p>
      <div className="flex justify-between mt-2.5 px-2">
        <div className="flex flex-col items-center gap-0.5">
          <Handle type="source" position={Position.Bottom} id="true" style={{ position: "relative", background: "var(--accent)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
          <span className="text-(--accent) text-[9px] font-bold">Sim</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <Handle type="source" position={Position.Bottom} id="false" style={{ position: "relative", background: "var(--red)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
          <span className="text-(--red) text-[9px] font-bold">Nao</span>
        </div>
      </div>
    </div>
  );
}
