import { SigiloPay } from "./sigilopay.js";
import { EvPay } from "./evpay.js";
import { ZuckPay } from "./zuckpay.js";
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

export function getGatewayKind(bot: BotPaymentConfig): GatewayKind {
  if (bot.payment_gateway === "evpay") return "evpay";
  if (bot.payment_gateway === "zuckpay") return "zuckpay";
  return "sigilopay";
}

export function buildGateway(bot: BotPaymentConfig): {
  gateway: PaymentGateway;
  kind: GatewayKind;
} {
  const kind = getGatewayKind(bot);
  if (kind === "evpay") {
    return {
      gateway: new EvPay(bot.evpay_api_key ?? "", bot.evpay_project_id ?? ""),
      kind: "evpay",
    };
  }
  if (kind === "zuckpay") {
    return {
      gateway: new ZuckPay(bot.zuckpay_client_id ?? "", bot.zuckpay_client_secret ?? ""),
      kind: "zuckpay",
    };
  }
  return {
    gateway: new SigiloPay(bot.sigilopay_public_key ?? "", bot.sigilopay_secret_key ?? ""),
    kind: "sigilopay",
  };
}
