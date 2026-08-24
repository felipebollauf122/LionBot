import { SigiloPay } from "./sigilopay.js";
import { EvPay } from "./evpay.js";
import { ZuckPay } from "./zuckpay.js";
import { NowPayments } from "./nowpayments.js";
import type { PaymentGateway } from "./payment-gateway.js";

export type GatewayKind = "sigilopay" | "evpay" | "zuckpay" | "nowpayments";

interface BotPaymentConfig {
  payment_gateway?: string | null;
  sigilopay_public_key?: string | null;
  sigilopay_secret_key?: string | null;
  evpay_api_key?: string | null;
  evpay_project_id?: string | null;
  zuckpay_client_id?: string | null;
  zuckpay_client_secret?: string | null;
  nowpayments_api_key?: string | null;
  nowpayments_ipn_secret_key?: string | null;
  nowpayments_pay_currency?: string | null;
}

export function getGatewayKind(bot: BotPaymentConfig): GatewayKind {
  if (bot.payment_gateway === "evpay") return "evpay";
  if (bot.payment_gateway === "zuckpay") return "zuckpay";
  if (bot.payment_gateway === "nowpayments") return "nowpayments";
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
  if (kind === "nowpayments") {
    return {
      gateway: new NowPayments(
        bot.nowpayments_api_key ?? "",
        bot.nowpayments_ipn_secret_key ?? "",
        bot.nowpayments_pay_currency ?? "usdttrc20",
      ),
      kind: "nowpayments",
    };
  }
  return {
    gateway: new SigiloPay(bot.sigilopay_public_key ?? "", bot.sigilopay_secret_key ?? ""),
    kind: "sigilopay",
  };
}
