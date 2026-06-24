import type { NodeContext, NodeResult } from "./types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentGateway } from "../services/payment-gateway.js";
export interface ExecuteNodeDeps {
    db?: SupabaseClient;
    gateway?: PaymentGateway;
    gatewayKind?: "sigilopay" | "evpay";
    baseWebhookUrl?: string;
}
export declare function executeNode(ctx: NodeContext, deps?: ExecuteNodeDeps): Promise<NodeResult>;
