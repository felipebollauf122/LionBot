import type { TelegramApi } from "../telegram/api.js";
export interface FlowNode {
    id: string;
    type: string;
    data: Record<string, unknown>;
    position: {
        x: number;
        y: number;
    };
}
export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
}
export interface Lead {
    id: string;
    tenant_id: string;
    bot_id: string;
    telegram_user_id: number;
    first_name: string;
    last_name: string | null;
    username: string | null;
    tid: string | null;
    fbclid: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    current_flow_id: string | null;
    current_node_id: string | null;
    active_flow_name: string | null;
    state: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export interface NodeContext {
    node: FlowNode;
    lead: Lead;
    edges: FlowEdge[];
    telegram: TelegramApi;
    chatId: number;
}
export interface NodeResult {
    nextNodeId: string | null;
    stateUpdates?: Record<string, unknown>;
    delaySeconds?: number;
    /** Message IDs sent by this node (used by black flow for auto-deletion) */
    messageIds?: number[];
    /** True when the user has blocked the bot — flow should stop and lead should be flagged */
    blocked?: boolean;
}
export type NodeHandler = (ctx: NodeContext) => Promise<NodeResult>;
