"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.unmapped.color;

const KIND_LABEL: Record<string, string> = {
  skipped_branch: "Botão pulado (guard)",
  not_explored: "Não explorado",
  unsupported_media: "Mídia não suportada",
};

export function UnmappedNode({ data, selected }: NodeProps) {
  const kind = String(data.kind ?? "unmapped");
  const label = KIND_LABEL[kind] ?? "Não mapeado";
  const detail = data.original_label
    ? String(data.original_label)
    : data.media_kind
      ? String(data.media_kind)
      : "";

  return (
    <BaseNode type="unmapped" data={data} selected={selected} label={label} className="min-w-50 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      {detail && <p className="text-(--text-secondary) text-sm truncate">{detail}</p>}
      <p className="text-(--text-muted) text-[0.6875rem] mt-1">Revisar antes de ativar</p>
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
