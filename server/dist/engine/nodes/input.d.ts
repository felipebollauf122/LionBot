import type { FlowEdge } from "../types.js";
import type { NodeContext, NodeResult } from "../types.js";
export declare function handleInputNode(ctx: NodeContext): Promise<NodeResult>;
export declare function handleInputResponse(nodeId: string, variable: string, userResponse: string, edges: FlowEdge[]): NodeResult;
