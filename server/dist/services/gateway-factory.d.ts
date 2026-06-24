import type { PaymentGateway } from "./payment-gateway.js";
interface BotPaymentConfig {
    payment_gateway?: string | null;
    sigilopay_public_key?: string | null;
    sigilopay_secret_key?: string | null;
    evpay_api_key?: string | null;
    evpay_project_id?: string | null;
}
export declare function getGatewayKind(bot: BotPaymentConfig): "sigilopay" | "evpay";
export declare function buildGateway(bot: BotPaymentConfig): {
    gateway: PaymentGateway;
    kind: "sigilopay" | "evpay";
};
export {};
