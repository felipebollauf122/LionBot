"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.video.color;

export function VideoNode({ data, selected }: NodeProps) {
  const caption = String(data.caption ?? "").trim();

  return (
    <BaseNode type="video" data={data} selected={selected} label="Vídeo" className="min-w-45 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${COLOR} 8%, transparent)` }}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={COLOR}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: 0.5 }}
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
        {caption ? (
          <p className="text-(--text-secondary) text-sm min-w-0 truncate">{caption}</p>
        ) : (
          <p className="text-(--text-muted) text-sm italic">Sem legenda</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
