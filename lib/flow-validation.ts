/**
 * Server-side validation for flow data (nodes/edges) before persisting.
 * Pure util — no "use server". Manual validation, no external libs.
 */

const NODE_TYPES = new Set([
  "trigger",
  "text",
  "image",
  "video",
  "button",
  "payment_button",
  "delay",
  "condition",
  "input",
  "action",
  "unmapped",
]);

const MAX_NODES = 500;
const MAX_EDGES = 1000;
const MAX_ID_LENGTH = 128;
const MAX_HANDLE_LENGTH = 256;
const MAX_SERIALIZED_LENGTH = 1_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}

export function validateFlowData(flowData: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isPlainObject(flowData)) {
    return { ok: false, reason: "flowData must be a plain object" };
  }

  const { nodes, edges } = flowData;

  if (!Array.isArray(nodes)) {
    return { ok: false, reason: "nodes must be an array" };
  }
  if (nodes.length > MAX_NODES) {
    return { ok: false, reason: `nodes exceeds the maximum of ${MAX_NODES}` };
  }

  for (let i = 0; i < nodes.length; i++) {
    const node: unknown = nodes[i];
    if (!isPlainObject(node)) {
      return { ok: false, reason: `nodes[${i}] must be an object` };
    }
    if (!isValidId(node.id)) {
      return { ok: false, reason: `nodes[${i}].id must be a string of 1-${MAX_ID_LENGTH} chars` };
    }
    if (typeof node.type !== "string" || !NODE_TYPES.has(node.type)) {
      return { ok: false, reason: `nodes[${i}].type is not a recognized node type` };
    }
    const position = node.position;
    if (!isPlainObject(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return { ok: false, reason: `nodes[${i}].position must be an object with finite x/y numbers` };
    }
    if (!isPlainObject(node.data)) {
      return { ok: false, reason: `nodes[${i}].data must be a plain object` };
    }
  }

  if (!Array.isArray(edges)) {
    return { ok: false, reason: "edges must be an array" };
  }
  if (edges.length > MAX_EDGES) {
    return { ok: false, reason: `edges exceeds the maximum of ${MAX_EDGES}` };
  }

  for (let i = 0; i < edges.length; i++) {
    const edge: unknown = edges[i];
    if (!isPlainObject(edge)) {
      return { ok: false, reason: `edges[${i}] must be an object` };
    }
    if (!isValidId(edge.id)) {
      return { ok: false, reason: `edges[${i}].id must be a string of 1-${MAX_ID_LENGTH} chars` };
    }
    if (!isValidId(edge.source)) {
      return { ok: false, reason: `edges[${i}].source must be a string of 1-${MAX_ID_LENGTH} chars` };
    }
    if (!isValidId(edge.target)) {
      return { ok: false, reason: `edges[${i}].target must be a string of 1-${MAX_ID_LENGTH} chars` };
    }
    for (const key of ["sourceHandle", "targetHandle"] as const) {
      const handle = edge[key];
      if (handle !== undefined && handle !== null) {
        if (typeof handle !== "string" || handle.length > MAX_HANDLE_LENGTH) {
          return { ok: false, reason: `edges[${i}].${key} must be a string of up to ${MAX_HANDLE_LENGTH} chars` };
        }
      }
    }
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(flowData);
  } catch {
    return { ok: false, reason: "flowData is not serializable to JSON" };
  }
  if (typeof serialized !== "string" || serialized.length > MAX_SERIALIZED_LENGTH) {
    return { ok: false, reason: `flowData serialized size exceeds ${MAX_SERIALIZED_LENGTH} chars` };
  }

  return { ok: true };
}
