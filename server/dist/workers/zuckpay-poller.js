import { ZuckPay } from "../services/zuckpay.js";
/**
 * Roda a cada 5s. Pra cada transação ZuckPay pendente, consulta a API
 * perguntando o status atual. Se voltou PAID, dispara o mesmo pipeline
 * do webhook (processPaymentCallback). Fallback pra quando o webhook não chega.
 *
 * Escalonamento por idade (igual EvPay):
 *   - tx ≤ 5min  → poll a cada 5s
 *   - tx 5-30min → poll a cada 30s
 *   - tx 30min-24h → poll a cada 2min
 *   - tx > 24h   → ignora
 */
const lastPolledAt = new Map();
function shouldPoll(createdAt, txId, now) {
    const ageMs = now - new Date(createdAt).getTime();
    let intervalMs;
    if (ageMs <= 5 * 60_000)
        intervalMs = 5_000;
    else if (ageMs <= 30 * 60_000)
        intervalMs = 30_000;
    else if (ageMs <= 24 * 60 * 60_000)
        intervalMs = 120_000;
    else
        return false;
    const last = lastPolledAt.get(txId) ?? 0;
    if (now - last < intervalMs)
        return false;
    lastPolledAt.set(txId, now);
    return true;
}
/**
 * Lista as credenciais (client_id, client_secret) distintas de bots ZuckPay
 * de um tenant. Cada credencial será testada em ordem pra achar a tx.
 */
async function listTenantCredentials(db, tenantId) {
    const { data: bots } = await db
        .from("bots")
        .select("zuckpay_client_id, zuckpay_client_secret")
        .eq("tenant_id", tenantId)
        .not("zuckpay_client_id", "is", null)
        .not("zuckpay_client_secret", "is", null);
    if (!bots)
        return [];
    const seen = new Set();
    const out = [];
    for (const b of bots) {
        if (!b.zuckpay_client_id || !b.zuckpay_client_secret)
            continue;
        const k = `${b.zuckpay_client_id}::${b.zuckpay_client_secret}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push({ clientId: b.zuckpay_client_id, clientSecret: b.zuckpay_client_secret });
    }
    return out;
}
export async function pollZuckpayPendingTransactions(db) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pending } = await db
        .from("transactions")
        .select("id, bot_id, tenant_id, external_id, created_at")
        .eq("gateway", "zuckpay")
        .eq("status", "pending")
        .gte("created_at", dayAgo)
        .limit(100);
    if (!pending || pending.length === 0)
        return;
    const now = Date.now();
    const due = pending.filter((tx) => shouldPoll(tx.created_at, tx.id, now));
    if (due.length === 0)
        return;
    const byTenant = new Map();
    for (const tx of due) {
        const arr = byTenant.get(tx.tenant_id) ?? [];
        arr.push(tx);
        byTenant.set(tx.tenant_id, arr);
    }
    for (const [tenantId, txs] of byTenant) {
        const credentials = await listTenantCredentials(db, tenantId);
        if (credentials.length === 0) {
            console.log(`[zuckpay-poller] Tenant ${tenantId} sem credenciais ZuckPay, pulando ${txs.length} txs`);
            continue;
        }
        for (const tx of txs) {
            try {
                let found = null;
                for (const cred of credentials) {
                    const zuckpay = new ZuckPay(cred.clientId, cred.clientSecret);
                    const r = await zuckpay.getPaymentStatus(tx.external_id);
                    if (r) {
                        found = { status: r.status };
                        break;
                    }
                }
                if (!found) {
                    console.log(`[zuckpay-poller] tx ${tx.external_id} not found em ${credentials.length} credencial(is) do tenant ${tenantId}`);
                    continue;
                }
                const status = found.status.toUpperCase();
                // ZuckPay retorna PAID | PENDING | FAILED | EXPIRADO | UNKNOWN.
                if (!["PAID", "FAILED", "EXPIRADO", "EXPIRED", "REFUSED", "REFUNDED", "CHARGEBACK"].includes(status)) {
                    // Ainda pending — segue.
                    continue;
                }
                console.log(`[zuckpay-poller] tx ${tx.external_id} status=${status} — disparando pipeline`);
                const { processPaymentCallback } = await import("../webhook/payment.js");
                await processPaymentCallback(tx.bot_id, {
                    transactionId: tx.external_id,
                    status,
                });
                lastPolledAt.delete(tx.id);
            }
            catch (err) {
                console.error(`[zuckpay-poller] Erro processando tx ${tx.external_id}:`, err);
            }
        }
    }
}
