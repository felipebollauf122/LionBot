import type { SupabaseClient } from "@supabase/supabase-js";
import { NowPayments } from "../services/nowpayments.js";

interface PendingTransaction {
  id: string;
  bot_id: string;
  tenant_id: string;
  external_id: string;
  created_at: string;
}

interface NowPaymentsCredential {
  apiKey: string;
  ipnSecretKey: string;
  payCurrency: string;
}

/**
 * Roda a cada 5s. Pra cada transação NOWPayments pendente, consulta a API
 * perguntando o status atual. Se voltou "finished", dispara o mesmo pipeline
 * do webhook (processPaymentCallback). Fallback pra quando o IPN não chega.
 *
 * Escalonamento por idade (igual EvPay/ZuckPay), MAS o corte de "desistir"
 * é 72h em vez de 24h: confirmação na blockchain pode demorar bem mais que
 * PIX (taxa de rede subestimada, congestionamento) — 24h seria cedo demais
 * pra abandonar uma cobrança cripto ainda viva.
 *   - tx ≤ 5min  → poll a cada 5s
 *   - tx 5-30min → poll a cada 30s
 *   - tx 30min-72h → poll a cada 2min
 *   - tx > 72h   → ignora
 */
const lastPolledAt = new Map<string, number>();

function shouldPoll(createdAt: string, txId: string, now: number): boolean {
  const ageMs = now - new Date(createdAt).getTime();
  let intervalMs: number;
  if (ageMs <= 5 * 60_000) intervalMs = 5_000;
  else if (ageMs <= 30 * 60_000) intervalMs = 30_000;
  else if (ageMs <= 72 * 60 * 60_000) intervalMs = 120_000;
  else return false;

  const last = lastPolledAt.get(txId) ?? 0;
  if (now - last < intervalMs) return false;
  lastPolledAt.set(txId, now);
  return true;
}

/**
 * Lista as credenciais (api_key, ipn_secret_key, pay_currency) distintas de
 * bots NOWPayments de um tenant. Cada credencial será testada em ordem pra
 * achar a tx.
 */
async function listTenantCredentials(
  db: SupabaseClient,
  tenantId: string,
): Promise<NowPaymentsCredential[]> {
  const { data: bots } = await db
    .from("bots")
    .select("nowpayments_api_key, nowpayments_ipn_secret_key, nowpayments_pay_currency")
    .eq("tenant_id", tenantId)
    .not("nowpayments_api_key", "is", null)
    .not("nowpayments_ipn_secret_key", "is", null);

  if (!bots) return [];

  const seen = new Set<string>();
  const out: NowPaymentsCredential[] = [];
  for (const b of bots as Array<{
    nowpayments_api_key: string | null;
    nowpayments_ipn_secret_key: string | null;
    nowpayments_pay_currency: string | null;
  }>) {
    if (!b.nowpayments_api_key || !b.nowpayments_ipn_secret_key) continue;
    const k = `${b.nowpayments_api_key}::${b.nowpayments_ipn_secret_key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      apiKey: b.nowpayments_api_key,
      ipnSecretKey: b.nowpayments_ipn_secret_key,
      payCurrency: b.nowpayments_pay_currency ?? "usdttrc20",
    });
  }
  return out;
}

export async function pollNowPaymentsPendingTransactions(db: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await db
    .from("transactions")
    .select("id, bot_id, tenant_id, external_id, created_at")
    .eq("gateway", "nowpayments")
    .eq("status", "pending")
    .gte("created_at", cutoff)
    .limit(100);

  if (!pending || pending.length === 0) return;

  const now = Date.now();
  const due = (pending as PendingTransaction[]).filter((tx) =>
    shouldPoll(tx.created_at, tx.id, now),
  );
  if (due.length === 0) return;

  const byTenant = new Map<string, PendingTransaction[]>();
  for (const tx of due) {
    const arr = byTenant.get(tx.tenant_id) ?? [];
    arr.push(tx);
    byTenant.set(tx.tenant_id, arr);
  }

  for (const [tenantId, txs] of byTenant) {
    const credentials = await listTenantCredentials(db, tenantId);
    if (credentials.length === 0) {
      console.log(`[nowpayments-poller] Tenant ${tenantId} sem credenciais NOWPayments, pulando ${txs.length} txs`);
      continue;
    }

    for (const tx of txs) {
      try {
        let found: { status: string } | null = null;
        for (const cred of credentials) {
          const nowpayments = new NowPayments(cred.apiKey, cred.ipnSecretKey, cred.payCurrency);
          const r = await nowpayments.getPaymentStatus(tx.external_id);
          if (r) {
            found = { status: r.status };
            break;
          }
        }

        if (!found) {
          console.log(
            `[nowpayments-poller] tx ${tx.external_id} not found em ${credentials.length} credencial(is) do tenant ${tenantId}`,
          );
          continue;
        }

        // Mesma tradução do webhook (NowPayments.mapPaymentStatus, static
        // compartilhada) — evita as duas rotas divergirem. Só age em estados
        // terminais; o resto (waiting/confirming/confirmed/sending/
        // partially_paid) segue pending, sem chamar processPaymentCallback à toa.
        const status = NowPayments.mapPaymentStatus(found.status);
        if (status !== "PAID" && status !== "FAILED" && status !== "REFUNDED") continue;

        console.log(`[nowpayments-poller] tx ${tx.external_id} status=${status} — disparando pipeline`);

        const { processPaymentCallback } = await import("../webhook/payment.js");
        await processPaymentCallback(tx.bot_id, {
          transactionId: tx.external_id,
          status,
        });
        lastPolledAt.delete(tx.id);
      } catch (err) {
        console.error(`[nowpayments-poller] Erro processando tx ${tx.external_id}:`, err);
      }
    }
  }
}
