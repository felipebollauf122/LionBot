"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.delay.color;

export function DelayNode({ data, selected }: NodeProps) {
  const amount = Number(data.amount ?? 0);
  const unit = String(data.unit ?? "seconds");
  const unitLabel = unit === "seconds" ? "seg" : unit === "minutes" ? "min" : "hrs";

  return (
    <BaseNode type="delay" data={data} selected={selected} className="min-w-40">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      <p className="text-foreground text-sm font-medium stat-value">{amount} {unitLabel}</p>
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
