"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.trigger.color;

export function TriggerNode({ data, selected }: NodeProps) {
  const trigger = String(data.trigger ?? "command");
  const command = String(data.command ?? "").trim();

  return (
    <BaseNode type="trigger" data={data} selected={selected} className="min-w-45">
      {trigger === "command" ? (
        command ? (
          <p className="text-foreground text-sm font-medium">{command}</p>
        ) : (
          <p className="text-(--text-muted) text-sm italic">Sem comando</p>
        )
      ) : (
        <p className="text-foreground text-sm font-medium">
          {trigger === "first_contact" ? "Primeiro contato" : trigger}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
