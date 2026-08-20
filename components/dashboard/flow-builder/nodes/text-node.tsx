"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.text.color;

export function TextNode({ data, selected }: NodeProps) {
  const variants = Array.isArray(data.text_variants) ? (data.text_variants as unknown[]) : [];
  const text = String(data.text ?? "").trim() || String(variants[0] ?? "").trim();
  const preview = text.length > 60 ? text.slice(0, 60) + "..." : text;

  return (
    <BaseNode type="text" data={data} selected={selected} className="min-w-50 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      {preview ? (
        <p className="text-(--text-secondary) text-sm">{preview}</p>
      ) : (
        <p className="text-(--text-muted) text-sm italic">Mensagem vazia</p>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
