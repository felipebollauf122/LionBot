"use server";

import { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types/database";

export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("role")
    .eq("id", user.id)
    .single();

  return tenant?.role === "admin";
}

export async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("role")
    .eq("id", user.id)
    .single();

  if (tenant?.role !== "admin") throw new Error("Forbidden");
  return user.id;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  bots_total: number;
  bots_active: number;
  leads_total: number;
  transactions_total: number;
  revenue_total: number;
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: tenants } = await supabase
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });

  if (!tenants || tenants.length === 0) return [];

  const users: AdminUser[] = [];

  for (const t of tenants as Tenant[]) {
    const { data: bots } = await supabase
      .from("bots")
      .select("is_active")
      .eq("tenant_id", t.id);

    const { count: leadsTotal } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", t.id);

    const { data: txs } = await supabase
      .from("transactions")
      .select("amount")
      .eq("tenant_id", t.id)
      .eq("status", "approved");

    users.push({
      id: t.id,
      email: t.email,
      name: t.name,
      role: t.role,
      plan: t.plan,
      created_at: t.created_at,
      last_sign_in_at: null,
      bots_total: bots?.length ?? 0,
      bots_active: bots?.filter((b) => b.is_active).length ?? 0,
      leads_total: leadsTotal ?? 0,
      transactions_total: txs?.length ?? 0,
      revenue_total: (txs ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0),
    });
  }

  return users;
}

export async function getAdminUserProfile(userId: string): Promise<AdminUser | null> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", userId)
    .single();

  if (!tenant) return null;

  const t = tenant as Tenant;

  const { data: bots } = await supabase
    .from("bots")
    .select("is_active")
    .eq("tenant_id", t.id);

  const { count: leadsTotal } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t.id);

  const { data: txs } = await supabase
    .from("transactions")
    .select("amount")
    .eq("tenant_id", t.id)
    .eq("status", "approved");

  return {
    id: t.id,
    email: t.email,
    name: t.name,
    role: t.role,
    plan: t.plan,
    created_at: t.created_at,
    last_sign_in_at: null,
    bots_total: bots?.length ?? 0,
    bots_active: bots?.filter((b) => b.is_active).length ?? 0,
    leads_total: leadsTotal ?? 0,
    transactions_total: txs?.length ?? 0,
    revenue_total: (txs ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0),
  };
}

export interface AdminBot {
  id: string;
  bot_username: string;
  is_active: boolean;
  created_at: string;
  leads_count: number;
  revenue: number;
}

export async function getAdminUserBots(userId: string): Promise<AdminBot[]> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: bots } = await supabase
    .from("bots")
    .select("id, bot_username, is_active, created_at")
    .eq("tenant_id", userId)
    .order("created_at", { ascending: false });

  if (!bots || bots.length === 0) return [];

  const result: AdminBot[] = [];

  for (const bot of bots) {
    const { count: leadsCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("bot_id", bot.id);

    const { data: txs } = await supabase
      .from("transactions")
      .select("amount")
      .eq("bot_id", bot.id)
      .eq("status", "approved");

    result.push({
      id: bot.id,
      bot_username: bot.bot_username,
      is_active: bot.is_active,
      created_at: bot.created_at,
      leads_count: leadsCount ?? 0,
      revenue: (txs ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0),
    });
  }

  return result;
}

export async function updateUserRole(userId: string, role: "user" | "admin"): Promise<{ success: boolean }> {
  const adminId = await requireAdmin();
  const supabase = await createClient();

  if (userId === adminId && role !== "admin") {
    throw new Error("Cannot remove your own admin role");
  }

  const { error } = await supabase
    .from("tenants")
    .update({ role })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Visão de admin: alternar a dashboard/análises entre "minha", "todos" ou um
// usuário específico. Só admin pode ver dados de outros — validado no servidor.
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewableUser {
  id: string;
  name: string;
  email: string;
}

/** Lista enxuta (id/nome/email) de todos os usuários, p/ o seletor de admin. */
export async function getViewableUsers(): Promise<ViewableUser[]> {
  if (!(await isAdmin())) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id,name,email")
    .order("created_at", { ascending: false });
  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: ((t.name as string) || "").trim() || ((t.email as string)?.split("@")[0] ?? "Usuário"),
    email: (t.email as string) ?? "",
  }));
}

export interface ViewScope {
  /** tenant_id a filtrar; null = todos (só admin). */
  tenantId: string | null;
  /** modo efetivo aplicado (pode diferir do pedido se sem permissão). */
  mode: "mine" | "all" | "user";
  isAdmin: boolean;
}

/**
 * Resolve QUAL tenant a dashboard/análises deve mostrar, com SEGURANÇA:
 * - não-admin → sempre o próprio (ignora qualquer pedido).
 * - admin + "all" (ou vazio) → null = todos.
 * - admin + "mine" → o próprio id.
 * - admin + <tenantId> → esse tenant.
 * `requested` vem do searchParam `view` (mine | all | <uuid>).
 */
export async function resolveViewScope(requested?: string): Promise<ViewScope> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { tenantId: null, mode: "mine", isAdmin: false };

  const admin = await isAdmin();
  if (!admin) {
    // usuário comum: sempre vê só os próprios dados (RLS já garante, mas
    // filtramos explícito pra consistência com o admin em modo "mine").
    return { tenantId: user.id, mode: "mine", isAdmin: false };
  }

  // admin: DEFAULT é "minha" (sem ?view) — abre sempre na dashboard pessoal.
  // "Todos" só quando explicitamente pedido (?view=all).
  if (!requested || requested === "mine") return { tenantId: user.id, mode: "mine", isAdmin: true };
  if (requested === "all") return { tenantId: null, mode: "all", isAdmin: true };
  // requested é um tenantId específico
  return { tenantId: requested, mode: "user", isAdmin: true };
}
