"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type { Lead, LeadMessage } from "@/lib/types/database";

/**
 * Aba CLIENTES + chat ao vivo.
 *
 * Tudo aqui é lazy: só roda quando o usuário abre a aba (a página é um
 * server component que chama getClients na 1ª render; o chat de um lead só
 * busca getLeadMessages quando aquele lead é selecionado). Nada disso carrega
 * no resto do app.
 *
 * RLS isola por tenant. Admin/owner enxergam qualquer bot (mesmo padrão do
 * resto do painel — checa isAdmin()).
 */

export type ClientStatus = "paid" | "pending" | "new" | "blocked";

export interface ClientRow {
  lead: Lead;
  status: ClientStatus;
  /** total pago em centavos (soma das transações aprovadas) */
  paidAmount: number;
  /** quando teve a última atividade conhecida (created_at do lead por ora) */
  lastActivity: string;
}

export interface ClientsResult {
  clients: ClientRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; paid: number; pending: number; new: number; blocked: number };
}

const PAGE_SIZE = 25;

async function assertBotAccess(botId: string): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let q = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) q = q.eq("tenant_id", user.id);
  const { data: bot } = await q.single();
  if (!bot) throw new Error("Bot not found");
  return user.id;
}

/**
 * Lista rica de clientes do bot: status (novo/pendente/pago/bloqueado),
 * total pago, busca por nome/username e filtro por segmento.
 */
export async function getClients(
  botId: string,
  opts: { page?: number; search?: string; segment?: ClientStatus | "all" } = {},
): Promise<ClientsResult> {
  await assertBotAccess(botId);
  const supabase = await createClient();

  const page = Math.max(1, opts.page ?? 1);
  const search = (opts.search ?? "").trim();
  const segment = opts.segment ?? "all";
  const offset = (page - 1) * PAGE_SIZE;

  // Contadores por segmento (sempre sobre o bot inteiro, ignora paginação).
  const [allC, blockedC, paidLeadIds, pendingLeadIds] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", botId),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("blocked", true),
    supabase.from("transactions").select("lead_id").eq("bot_id", botId).eq("status", "approved"),
    supabase.from("transactions").select("lead_id").eq("bot_id", botId).eq("status", "pending"),
  ]);

  const paidSet = new Set((paidLeadIds.data ?? []).map((r) => r.lead_id as string));
  const pendingSet = new Set((pendingLeadIds.data ?? []).map((r) => r.lead_id as string));

  // Página de leads.
  let q = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("bot_id", botId)
    .order("created_at", { ascending: false });

  if (search) q = q.or(`first_name.ilike.%${search}%,username.ilike.%${search}%,last_name.ilike.%${search}%`);
  if (segment === "blocked") q = q.eq("blocked", true);

  // Para segmentos baseados em transação, restringe por id.
  if (segment === "paid") {
    const ids = [...paidSet];
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  } else if (segment === "pending") {
    const ids = [...pendingSet].filter((id) => !paidSet.has(id));
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  } else if (segment === "new") {
    const excluded = [...new Set([...paidSet, ...pendingSet])];
    if (excluded.length) q = q.not("id", "in", `(${excluded.join(",")})`);
    q = q.eq("blocked", false);
  }

  q = q.range(offset, offset + PAGE_SIZE - 1);

  const { data: leads, count, error } = await q;
  if (error) throw new Error(`getClients: ${error.message}`);

  const pageLeads = (leads ?? []) as Lead[];

  // Soma do pago por lead (centavos) — só pros leads da página.
  const pageLeadIds = pageLeads.map((l) => l.id);
  const paidByLead = new Map<string, number>();
  if (pageLeadIds.length) {
    const { data: txs } = await supabase
      .from("transactions")
      .select("lead_id, amount")
      .eq("bot_id", botId)
      .eq("status", "approved")
      .in("lead_id", pageLeadIds);
    for (const t of txs ?? []) {
      const id = t.lead_id as string;
      paidByLead.set(id, (paidByLead.get(id) ?? 0) + Number(t.amount ?? 0));
    }
  }

  const clients: ClientRow[] = pageLeads.map((lead) => {
    let status: ClientStatus = "new";
    if (lead.blocked) status = "blocked";
    else if (paidSet.has(lead.id)) status = "paid";
    else if (pendingSet.has(lead.id)) status = "pending";
    return {
      lead,
      status,
      paidAmount: paidByLead.get(lead.id) ?? 0,
      lastActivity: lead.updated_at ?? lead.created_at,
    };
  });

  const totalAll = allC.count ?? 0;
  const totalBlocked = blockedC.count ?? 0;
  const totalPaid = paidSet.size;
  const totalPending = [...pendingSet].filter((id) => !paidSet.has(id)).length;
  const totalNew = Math.max(0, totalAll - totalPaid - totalPending - totalBlocked);

  return {
    clients,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    counts: {
      all: totalAll,
      paid: totalPaid,
      pending: totalPending,
      new: totalNew,
      blocked: totalBlocked,
    },
  };
}

/** Timeline de conversa de UM lead (chat). Só é chamada quando o lead abre. */
export async function getLeadMessages(leadId: string): Promise<LeadMessage[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // RLS já restringe ao tenant; admin lê tudo via policy própria do projeto.
  const { data, error } = await supabase
    .from("lead_messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw new Error(`getLeadMessages: ${error.message}`);
  return (data ?? []) as LeadMessage[];
}

export interface SendResult {
  ok: boolean;
  error?: "blocked" | "failed";
  message?: string;
}

/** Envia uma mensagem pelo bot para o lead (chat ao vivo). */
export async function sendMessageToLead(
  botId: string,
  leadId: string,
  text: string,
): Promise<SendResult> {
  await assertBotAccess(botId);

  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, error: "failed", message: "Mensagem vazia." };

  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  try {
    const res = await fetch(`${serverUrl}/api/bots/${botId}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, text: trimmed }),
    });
    if (res.status === 409) {
      return { ok: false, error: "blocked", message: "O lead bloqueou o bot." };
    }
    if (!res.ok) {
      return { ok: false, error: "failed", message: `Falha no envio (${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro de rede";
    return { ok: false, error: "failed", message: msg };
  }
}
