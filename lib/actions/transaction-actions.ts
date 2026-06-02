"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";

export async function getTransactions(botId: string, page: number = 1, statusFilter: string = "all") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("transactions")
    .select("*, products(name, ghost_name)", { count: "exact" })
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);

  return { transactions: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getTransactionStats(botId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { data: approved } = await supabase
    .from("transactions")
    .select("amount")
    .eq("bot_id", botId)
    .eq("status", "approved");

  const totalRevenue = (approved ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const totalSales = (approved ?? []).length;

  const { count: pendingCount } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("status", "pending");

  return { totalRevenue, totalSales, pendingCount: pendingCount ?? 0 };
}
