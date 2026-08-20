"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.action.color;

export function ActionNode({ data, selected }: NodeProps) {
  const actionType = String(data.action_type ?? "set_variable");
  const labels: Record<string, string> = { add_tag: "Adicionar tag", remove_tag: "Remover tag", set_variable: "Definir variável", start_flow: "Iniciar fluxo", stop_flow: "Parar fluxo" };
  const detail =
    actionType === "add_tag" || actionType === "remove_tag"
      ? String(data.tag ?? "").trim()
      : actionType === "set_variable" && String(data.variable ?? "").trim()
        ? `${String(data.variable)} = ${String(data.value ?? "")}`
        : "";

  return (
    <BaseNode type="action" data={data} selected={selected} label="Ação" className="min-w-45">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      <p className="text-foreground text-sm font-medium">{labels[actionType] ?? actionType}</p>
      {detail ? (
        <p className="text-(--text-muted) text-xs mt-0.5">{detail}</p>
      ) : actionType === "set_variable" ? (
        <p className="text-(--text-muted) text-xs mt-0.5 italic">Variável não definida</p>
      ) : null}
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
