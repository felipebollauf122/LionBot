import webpush from "web-push";
import { config } from "../config.js";
import { supabase } from "../db.js";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    return false; // push disabled — keys not set
  }
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  configured = true;
  return true;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send a push payload to every device a tenant has subscribed. */
export async function sendPushToTenant(tenantId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("tenant_id", tenantId);

  if (error || !subs || subs.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    (subs as SubRow[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410 = subscription expired/gone — clean it up.
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        } else {
          console.error("[push] send failed:", (err as Error).message);
        }
      }
    }),
  );
}

/** Convenience: notify the tenant that a sale was approved. */
export async function notifySale(
  tenantId: string,
  opts: { amount: number; productName?: string | null; botName?: string | null },
): Promise<void> {
  const value = (opts.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const parts = [value];
  if (opts.productName) parts.push(opts.productName);
  await sendPushToTenant(tenantId, {
    title: "💰 Venda aprovada!",
    body: parts.join(" · ") + (opts.botName ? ` (@${opts.botName})` : ""),
    url: "/dashboard",
    tag: "sale",
  });
}
