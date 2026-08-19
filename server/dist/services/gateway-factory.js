import { SigiloPay } from "./sigilopay.js";
import { EvPay } from "./evpay.js";
import { ZuckPay } from "./zuckpay.js";
export function getGatewayKind(bot) {
    if (bot.payment_gateway === "evpay")
        return "evpay";
    if (bot.payment_gateway === "zuckpay")
        return "zuckpay";
    return "sigilopay";
}
export function buildGateway(bot) {
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
