"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";

export async function getTrackingEvents(botId: string, page: number = 1) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  const { data, count, error } = await supabase
    .from("tracking_events")
    .select("*", { count: "exact" })
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw new Error(`Failed to fetch tracking events: ${error.message}`);
  return { events: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getTrackingFunnel(botId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const eventTypes = ["page_view", "bot_start", "view_offer", "checkout", "purchase"] as const;

  // 5 counts em paralelo (#38) — antes era waterfall (5 roundtrips seriais).
  const results = await Promise.all(
    eventTypes.map((eventType) =>
      supabase
        .from("tracking_events")
        .select("*", { count: "exact", head: true })
        .eq("bot_id", botId)
        .eq("event_type", eventType),
    ),
  );

  const counts: Record<string, number> = {};
  eventTypes.forEach((et, i) => {
    counts[et] = results[i].count ?? 0;
  });

  return counts;
}

export async function getTrackingLeads(botId: string, page: number = 1) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery2 = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery2 = botQuery2.eq("tenant_id", user.id);
  const { data: bot2 } = await botQuery2.single();
  if (!bot2) throw new Error("Bot not found");

  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  const { data, count, error } = await supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw new Error(`Failed to fetch leads: ${error.message}`);
  return { leads: data ?? [], total: count ?? 0, page, pageSize };
}
