"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export function TriggerNode({ data, selected }: NodeProps) {
  const trigger = String(data.trigger ?? "command");
  const command = String(data.command ?? "/start");

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-45 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--accent)" : "color-mix(in srgb, var(--accent) 20%, transparent)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--accent-glow), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <span className="text-(--accent) text-[10px] font-bold uppercase tracking-wider">Gatilho</span>
      </div>
      <p className="text-foreground text-sm font-medium">
        {trigger === "command" ? command : trigger === "first_contact" ? "Primeiro contato" : trigger}
      </p>
      <Handle type="source" position={Position.Bottom} style={{ background: "var(--accent)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
