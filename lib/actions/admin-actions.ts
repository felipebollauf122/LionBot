"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { invalidateBotCache } from "@/lib/actions/cache-actions";
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
  is_premium: boolean;
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
      is_premium: t.is_premium,
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
    is_premium: t.is_premium,
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
  /** vendas aprovadas — mesma contagem que alimenta AdminUser.transactions_total */
  transactions_count: number;
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
      transactions_count: txs?.length ?? 0,
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

export async function updateUserPremium(userId: string, isPremium: boolean): Promise<{ success: boolean }> {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("tenants")
    .update({ is_premium: isPremium })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transferência de posse de bot
// ─────────────────────────────────────────────────────────────────────────────

/** Sucesso: o que mudou, pra UI mostrar o resumo. */
export interface TransferBotOwnerOk {
  ok: true;
  /** false quando o bot já era do usuário de destino (no-op, não é erro). */
  changed: boolean;
  botUsername: string;
  oldTenantId: string;
  newTenantId: string;
  /** linhas movidas por tabela — vira "232 leads, 14 vendas…" na tela. */
  moved: Record<string, number>;
  /**
   * false = o servidor do bot não confirmou a limpeza do cache. Não desfaz a
   * transferência (o banco já mudou); só significa que o processo do bot pode
   * seguir com o dono antigo em memória por até o TTL do botCache (10 min).
   */
  cacheInvalidated: boolean;
}

/** Recusa esperada (guarda do banco), com a mensagem pronta pra exibir. */
export interface TransferBotOwnerFail {
  ok: false;
  message: string;
}

export type TransferBotOwnerResult = TransferBotOwnerOk | TransferBotOwnerFail;

/**
 * Recusas previstas da função SQL, pelo SQLSTATE que ela levanta. A mensagem
 * que volta do Postgres já está escrita em português e diz o que fazer
 * ("desmarque essa opção antes", "conclua ou apague a clonagem"), então é ela
 * que vai pra tela.
 */
const EXPECTED_TRANSFER_ERRORS = new Set([
  "42501", // insufficient_privilege — não é admin
  "55006", // object_in_use — bot de login MTProto / clonagem pendente
  "P0002", // no_data_found — bot ou usuário de destino não existe
]);

/**
 * Move um bot inteiro (e leads, vendas, flows, produtos, tracking, remarketing,
 * mensagens e mídia dele) para outro usuário. A partir daí, tudo desse bot —
 * inclusive notificação de venda e analytics — cai na conta do novo dono.
 *
 * O trabalho pesado é a função public.transfer_bot_owner (migration 067), que
 * faz os UPDATEs numa transação só. Aqui em cima ficam as duas coisas que o
 * banco não alcança: derrubar o cache em memória do servidor do bot (que
 * guarda a linha de bots, tenant_id incluso) e revalidar as páginas do painel.
 *
 * Devolve a recusa como DADO, nunca como exceção: em build de produção o Next
 * apaga a mensagem de qualquer erro lançado numa Server Action e entrega ao
 * browser um "An error occurred in the Server Components render…" genérico
 * (react-server-dom-webpack-client.browser.production.js). As guardas do banco
 * existem justamente pra explicar ao admin o que fazer — se virassem `throw`,
 * essa explicação sumiria em produção e sobraria um erro em inglês.
 */
export async function transferBotOwner(
  botId: string,
  newTenantId: string,
): Promise<TransferBotOwnerResult> {
  try {
    // Redundante com o is_admin() de dentro da função SQL — mas pega o caso
    // "sessão expirou" antes de ir ao banco.
    await requireAdmin();
  } catch {
    return { ok: false, message: "Só um admin pode transferir a posse de um bot." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("transfer_bot_owner", {
    p_bot_id: botId,
    p_new_tenant_id: newTenantId,
  });

  if (error) {
    if (EXPECTED_TRANSFER_ERRORS.has(error.code ?? "")) {
      return { ok: false, message: error.message };
    }
    // Inesperado: o detalhe vai pro log do servidor, não pra tela.
    console.error("[transferBotOwner] erro inesperado:", error);
    return { ok: false, message: "Não foi possível transferir o bot. Tente de novo." };
  }

  const result = (data ?? {}) as {
    changed?: boolean;
    bot_username?: string;
    old_tenant_id?: string;
    new_tenant_id?: string;
    moved?: Record<string, number>;
  };

  // O servidor do bot cacheia a linha de `bots` por 10 min (server/src/cache.ts).
  // Sem isso, um lead que chegasse logo depois ainda seria gravado com o
  // tenant_id antigo. Só faz sentido quando algo mudou de verdade.
  const cacheInvalidated = result.changed === false ? true : await invalidateBotCache(botId);

  // 'layout' derruba tudo que pende de /dashboard: lista de bots do dono
  // antigo, do novo, painel admin, vendas e análises — todos leem tenant_id.
  revalidatePath("/dashboard", "layout");

  return {
    ok: true,
    changed: result.changed ?? false,
    botUsername: result.bot_username ?? "",
    oldTenantId: result.old_tenant_id ?? "",
    newTenantId: result.new_tenant_id ?? newTenantId,
    moved: result.moved ?? {},
    cacheInvalidated,
  };
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
/**
 * Resolve QUAL tenant uma Server Action de escrita deve usar, com SEGURANÇA:
 * o valor pedido pelo cliente (`requestedTenantId`, tipicamente vindo do
 * seletor "Minha/Todos/Usuário") só é honrado se quem chama é admin de
 * verdade — reconferido aqui no servidor a cada chamada, nunca confiando no
 * que o cliente mandou. Não-admin (ou admin sem pedir outro tenant) sempre
 * cai no próprio id. Usado pelas actions de Automações pra deixar o admin
 * agir "como" o usuário selecionado (criar conta/campanha/clone etc.).
 */
export async function resolveActingTenantId(requestedTenantId?: string | null): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  if (!requestedTenantId || requestedTenantId === user.id) return user.id;
  if (!(await isAdmin())) return user.id;
  return requestedTenantId;
}

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
