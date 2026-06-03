"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";

/**
 * Lista transações "órfãs": status=approved (cliente pagou) mas SEM o flag
 * delivered_tx_<id> no state do lead (entrega nunca foi confirmada). É o
 * "pagou e não recebeu". Read-only — não altera nada, só investigação.
 *
 * Estratégia: busca approved do bot + os leads correspondentes, e filtra
 * em memória quem não tem o flag de entrega. Nome do produto sempre ghost
 * (nunca o real — regra do dono).
 */
export async function getOrphanedTransactions(botId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  // Approved transactions do bot (últimas 500, ordem decrescente)
  const { data: txs } = await supabase
    .from("transactions")
    .select("id, external_id, amount, currency, status, paid_at, created_at, lead_id, products(name, ghost_name)")
    .eq("bot_id", botId)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .limit(500);

  const list = (txs ?? []) as unknown as Array<{
    id: string;
    external_id: string;
    amount: number;
    currency: string;
    status: string;
    paid_at: string | null;
    created_at: string;
    lead_id: string;
    products: { name: string; ghost_name: string | null } | null;
  }>;
  if (list.length === 0) return { transactions: [], total: 0 };

  // Busca os leads dessas transações (state pra checar delivered_tx flag)
  const leadIds = Array.from(new Set(list.map((t) => t.lead_id)));
  const { data: leads } = await supabase
    .from("leads")
    .select("id, telegram_user_id, first_name, state")
    .in("id", leadIds);
  const leadMap = new Map(
    ((leads ?? []) as Array<{ id: string; telegram_user_id: number; first_name: string; state: Record<string, unknown> }>).map(
      (l) => [l.id, l],
    ),
  );

  const orphaned = list
    .map((t) => {
      const lead = leadMap.get(t.lead_id);
      const delivered = lead?.state?.[`delivered_tx_${t.id}`] === true;
      if (delivered) return null;
      return {
        id: t.id,
        external_id: t.external_id,
        amount: t.amount,
        currency: t.currency,
        paid_at: t.paid_at,
        created_at: t.created_at,
        product_name: t.products?.ghost_name || t.products?.name || "—",
        telegram_user_id: lead?.telegram_user_id ?? null,
        first_name: lead?.first_name ?? "—",
        lead_id: t.lead_id,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { transactions: orphaned, total: orphaned.length };
}

/**
 * Reenvia o acesso (produto/mensagens) pra uma lista de transações órfãs.
 * Delega pro engine, que reexecuta o fluxo "paid" de cada uma. Tracking
 * (Facebook/Utmify) não duplica. Verifica que o bot é do tenant.
 */
export async function redeliverAccess(botId: string, transactionIds: string[]): Promise<{ ok: boolean; queued: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  if (!transactionIds.length) return { ok: true, queued: 0 };

  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const res = await fetch(`${serverUrl}/api/transactions/redeliver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionIds }),
  });
  if (!res.ok) throw new Error(`Falha ao reenviar (${res.status})`);
  return { ok: true, queued: transactionIds.length };
}
