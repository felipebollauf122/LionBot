"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.audio.color;

export function AudioNode({ data, selected }: NodeProps) {
  const caption = String(data.caption ?? "").trim();
  const fileName = String(data.audio_url ?? "").split("/").pop() ?? "";
  const recording = data.simulate_recording !== false;

  return (
    <BaseNode type="audio" data={data} selected={selected} label="Áudio" className="min-w-45 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      <div className="flex items-center gap-2">
        {/* Waveform: eco visual da bolha de voz que o lead vai receber. */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center gap-[2px] shrink-0"
          style={{ background: `color-mix(in srgb, ${COLOR} 8%, transparent)` }}
          aria-hidden="true"
        >
          {[7, 12, 16, 10, 5].map((h, i) => (
            <span
              key={i}
              className="w-[2px] rounded-full"
              style={{ height: h, background: COLOR, opacity: 0.55 }}
            />
          ))}
        </div>
        <p className="text-(--text-secondary) text-sm min-w-0 truncate">
          {caption || fileName || <span className="text-(--text-muted) italic">Sem áudio</span>}
        </p>
      </div>
      {recording && (
        <p className="text-[0.6875rem] mt-1.5" style={{ color: COLOR, opacity: 0.7 }}>
          simula &quot;gravando áudio…&quot;
        </p>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
