import { SigiloPay } from "./sigilopay.js";
import { EvPay } from "./evpay.js";
export function getGatewayKind(bot) {
    return bot.payment_gateway === "evpay" ? "evpay" : "sigilopay";
}
export function buildGateway(bot) {
    const kind = getGatewayKind(bot);
    if (kind === "evpay") {
        return {
            gateway: new EvPay(bot.evpay_api_key ?? "", bot.evpay_project_id ?? ""),
            kind: "evpay",
        };
    }
    return {
        gateway: new SigiloPay(bot.sigilopay_public_key ?? "", bot.sigilopay_secret_key ?? ""),
        kind: "sigilopay",
    };
}
