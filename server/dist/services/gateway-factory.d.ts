import type { PaymentGateway } from "./payment-gateway.js";
export type GatewayKind = "sigilopay" | "evpay" | "zuckpay";
interface BotPaymentConfig {
    payment_gateway?: string | null;
    sigilopay_public_key?: string | null;
    sigilopay_secret_key?: string | null;
    evpay_api_key?: string | null;
    evpay_project_id?: string | null;
    zuckpay_client_id?: string | null;
    zuckpay_client_secret?: string | null;
}
export declare function getGatewayKind(bot: BotPaymentConfig): GatewayKind;
export declare function buildGateway(bot: BotPaymentConfig): {
    gateway: PaymentGateway;
    kind: GatewayKind;
};
export {};
