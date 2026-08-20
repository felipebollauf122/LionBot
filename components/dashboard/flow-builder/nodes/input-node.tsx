"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.input.color;

export function InputNode({ data, selected }: NodeProps) {
  const prompt = String(data.prompt ?? "").trim();
  const variable = String(data.variable ?? "").trim();

  return (
    <BaseNode type="input" data={data} selected={selected} className="min-w-50 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      {prompt ? (
        <p className="text-(--text-secondary) text-sm">{prompt.length > 50 ? prompt.slice(0, 50) + "..." : prompt}</p>
      ) : (
        <p className="text-(--text-muted) text-sm italic">Sem pergunta</p>
      )}
      {variable ? (
        <p className="text-[0.6875rem] mt-1.5 stat-value" style={{ color: COLOR, opacity: 0.7 }}>{`→ {{${variable}}}`}</p>
      ) : (
        <p className="text-(--text-muted) text-[0.6875rem] mt-1.5 italic">Sem variável de destino</p>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
