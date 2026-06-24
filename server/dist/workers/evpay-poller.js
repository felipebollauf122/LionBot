import { EvPay } from "../services/evpay.js";
/**
 * Roda a cada 5s. Pra cada transação EvPay pendente, consulta a API
 * da Yvepay perguntando o status atual. Se voltou APPROVED, dispara
 * o mesmo pipeline do webhook (processPaymentCallback) → marca
 * approved no DB, pede email ou completa Purchase, etc.
 *
 * Existe pra resolver o caso em que a Yvepay aprova a venda mas não
 * envia webhook automático.
 *
 * Escalonamento por idade:
 *   - tx ≤ 5min  → poll a cada 5s
 *   - tx 5-30min → poll a cada 30s
 *   - tx 30min-24h → poll a cada 2min
 *   - tx > 24h   → ignora
 *
 * Estratégia de credencial: pra cada tx, tenta TODAS as credenciais
 * EvPay distintas do mesmo tenant — não confia que o bot dono ainda
 * tenha as credenciais certas (pode ter trocado de projeto, ou ter
 * sido criado quando outro projeto estava ativo).
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
 * Lista todas as combinações (apiKey, projectId) distintas de bots
 * EvPay de um tenant. Cada credencial será testada em ordem pra
 * achar a tx no Yvepay.
 */
async function listTenantCredentials(db, tenantId) {
    const { data: bots } = await db
        .from("bots")
        .select("evpay_api_key, evpay_project_id")
        .eq("tenant_id", tenantId)
        .not("evpay_api_key", "is", null)
        .not("evpay_project_id", "is", null);
    if (!bots)
        return [];
    const seen = new Set();
    const out = [];
    for (const b of bots) {
        if (!b.evpay_api_key || !b.evpay_project_id)
            continue;
        const k = `${b.evpay_api_key}::${b.evpay_project_id}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push({ apiKey: b.evpay_api_key, projectId: b.evpay_project_id });
    }
    return out;
}
export async function pollEvpayPendingTransactions(db) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pending } = await db
        .from("transactions")
        .select("id, bot_id, tenant_id, external_id, created_at")
        .eq("gateway", "evpay")
        .eq("status", "pending")
        .gte("created_at", dayAgo)
        .limit(100);
    if (!pending || pending.length === 0)
        return;
    const now = Date.now();
    const due = pending.filter((tx) => shouldPoll(tx.created_at, tx.id, now));
    if (due.length === 0)
        return;
    // Agrupa por tenant pra resolver credenciais 1x por tenant
    const byTenant = new Map();
    for (const tx of due) {
        const arr = byTenant.get(tx.tenant_id) ?? [];
        arr.push(tx);
        byTenant.set(tx.tenant_id, arr);
    }
    for (const [tenantId, txs] of byTenant) {
        const credentials = await listTenantCredentials(db, tenantId);
        if (credentials.length === 0) {
            console.log(`[evpay-poller] Tenant ${tenantId} sem credenciais EvPay, pulando ${txs.length} txs`);
            continue;
        }
        for (const tx of txs) {
            try {
                // Tenta cada credencial até uma encontrar a tx
                let found = null;
                for (const cred of credentials) {
                    const evpay = new EvPay(cred.apiKey, cred.projectId);
                    const r = await evpay.getPaymentStatus(tx.external_id);
                    if (r) {
                        found = { status: r.status, credential: cred };
                        break;
                    }
                }
                if (!found) {
                    console.log(`[evpay-poller] tx ${tx.external_id} not found em ${credentials.length} projeto(s) do tenant ${tenantId}`);
                    continue;
                }
                const status = found.status.toUpperCase();
                if (!["APPROVED", "EXPIRED", "FAILED", "REFUNDED", "PAID"].includes(status)) {
                    // Ainda pending no Yvepay — log com debounce
                    continue;
                }
                console.log(`[evpay-poller] tx ${tx.external_id} status=${status} (proj=${found.credential.projectId}) — disparando pipeline`);
                const { processPaymentCallback } = await import("../webhook/payment.js");
                await processPaymentCallback(tx.bot_id, {
                    transactionId: tx.external_id,
                    status,
                });
                lastPolledAt.delete(tx.id);
            }
            catch (err) {
                console.error(`[evpay-poller] Erro processando tx ${tx.external_id}:`, err);
            }
        }
    }
}
