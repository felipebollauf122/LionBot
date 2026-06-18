"use server";

import { createClient } from "@/lib/supabase/server";

interface SubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Save (upsert) a Web Push subscription for the logged-in tenant. */
export async function savePushSubscription(sub: SubscriptionJSON, userAgent?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      tenant_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: userAgent ?? null,
    },
    { onConflict: "tenant_id,endpoint" },
  );

  if (error) throw new Error(`Falha ao salvar inscrição: ${error.message}`);
  return { ok: true };
}

/** Remove a subscription (when the user disables push on this device). */
export async function removePushSubscription(endpoint: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("tenant_id", user.id)
    .eq("endpoint", endpoint);

  if (error) throw new Error(`Falha ao remover inscrição: ${error.message}`);
  return { ok: true };
}
