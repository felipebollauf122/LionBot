import type { SupabaseClient } from "@supabase/supabase-js";
import type { NodeContext, NodeResult } from "../types.js";
import type { PaymentGateway } from "../../services/payment-gateway.js";
export declare function handlePaymentBundleNode(ctx: NodeContext, db: SupabaseClient, _gateway: PaymentGateway, _baseWebhookUrl: string): Promise<NodeResult>;
export declare function handleProductPaymentCallback(ctx: NodeContext, db: SupabaseClient, gateway: PaymentGateway, baseWebhookUrl: string, productId: string, gatewayKind?: "sigilopay" | "evpay"): Promise<NodeResult>;
