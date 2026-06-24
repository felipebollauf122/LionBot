import webpush from "web-push";
import { config } from "../config.js";
import { supabase } from "../db.js";
let configured = false;
function ensureConfigured() {
    if (configured)
        return true;
    if (!config.vapidPublicKey || !config.vapidPrivateKey) {
        return false; // push disabled — keys not set
    }
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    configured = true;
    return true;
}
/** Send a push payload to every device a tenant has subscribed. */
export async function sendPushToTenant(tenantId, payload) {
    if (!ensureConfigured())
        return;
    const { data: subs, error } = await supabase
        .from("push_subscriptions")
        .select("endpoint,p256dh,auth")
        .eq("tenant_id", tenantId);
    if (error || !subs || subs.length === 0)
        return;
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        }
        catch (err) {
            const statusCode = err.statusCode;
            // 404/410 = subscription expired/gone — clean it up.
            if (statusCode === 404 || statusCode === 410) {
                await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
            }
            else {
                console.error("[push] send failed:", err.message);
            }
        }
    }));
}
/** Convenience: notify the tenant that a sale was approved.
 *  Mensagem enxuta: SÓ "Venda aprovada" + a quantia (sem nome de produto/bot). */
export async function notifySale(tenantId, opts) {
    const value = (opts.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await sendPushToTenant(tenantId, {
        title: "💰 Venda aprovada!",
        body: value,
        url: "/dashboard",
        tag: "sale",
    });
}
