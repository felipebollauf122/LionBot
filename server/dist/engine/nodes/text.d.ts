import type { NodeContext, NodeResult } from "../types.js";
export declare function findNextNodeId(edges: NodeContext["edges"], currentNodeId: string, handle?: string): string | null;
export declare function handleTextNode(ctx: NodeContext): Promise<NodeResult>;
