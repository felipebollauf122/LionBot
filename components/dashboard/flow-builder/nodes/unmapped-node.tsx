"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

const KIND_LABEL: Record<string, string> = {
  skipped_branch: "Botao pulado (guard)",
  not_explored: "Nao explorado",
  unsupported_media: "Midia nao suportada",
};

export function UnmappedNode({ data, selected }: NodeProps) {
  const kind = String(data.kind ?? "unmapped");
  const label = KIND_LABEL[kind] ?? "Nao mapeado";
  const detail = data.original_label
    ? String(data.original_label)
    : data.media_kind
      ? String(data.media_kind)
      : "";

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-50 max-w-70 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--amber)" : "color-mix(in srgb, var(--amber) 25%, transparent)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--amber-glow, var(--amber)), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--amber)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--amber) 15%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <span className="text-(--amber) text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      {detail && <p className="text-(--text-secondary) text-sm truncate">{detail}</p>}
      <p className="text-(--text-ghost) text-[10px] mt-1">Revisar antes de ativar</p>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--amber)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
