"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode, inlineHandleStyle } from "./base-node";

const COLOR = NODE_META.condition.color;

export function ConditionNode({ data, selected }: NodeProps) {
  const field = String(data.field ?? "").trim();
  const operator = String(data.operator ?? "equals");
  const value = String(data.value ?? "");
  const opLabel: Record<string, string> = { equals: "=", not_equals: "!=", exists: "existe", not_exists: "não existe", contains: "contém", greater_than: ">", less_than: "<" };

  return (
    <BaseNode type="condition" data={data} selected={selected} label="Condição" className="min-w-50">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      {field ? (
        <p className="text-(--text-secondary) text-sm">
          {field} <span className="font-medium stat-value" style={{ color: COLOR }}>{opLabel[operator] ?? operator}</span> {value}
        </p>
      ) : (
        <p className="text-(--text-muted) text-sm italic">Campo não definido</p>
      )}
      {/* ids "true"/"false" — contrato com a engine, NÃO mudar. */}
      <div className="flex justify-between mt-1.5 px-1">
        <div className="flex flex-col items-center">
          <Handle type="source" position={Position.Bottom} id="true" style={inlineHandleStyle("var(--accent)")} />
          <span className="text-(--accent) text-[0.6875rem] font-semibold leading-none">Sim</span>
        </div>
        <div className="flex flex-col items-center">
          <Handle type="source" position={Position.Bottom} id="false" style={inlineHandleStyle("var(--red)")} />
          <span className="text-(--red) text-[0.6875rem] font-semibold leading-none">Não</span>
        </div>
      </div>
    </BaseNode>
  );
}
