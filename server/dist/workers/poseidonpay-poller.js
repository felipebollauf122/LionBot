import { SigiloPay } from "../services/sigilopay.js";
/**
 * Roda a cada 5s. Pra cada transação Poseidon Pay pendente, consulta
 * o status atual. Se voltou aprovado, dispara processPaymentCallback
 * (mesmo pipeline do webhook).
 *
 * Existe pra resolver "cliente paga e não recebe": se o webhook
 * automático da Poseidon falhar (rede caiu, Cloudflare bloqueou,
 * evento perdido), o poller pega o pagamento dentro de segundos.
 *
 * Escalonamento por idade:
 *   - tx ≤ 5min  → poll a cada 5s
 *   - tx 5-30min → poll a cada 30s
 *   - tx 30min-24h → poll a cada 2min
 *   - tx > 24h   → ignora
 *
 * Tenta TODAS as credenciais Poseidon distintas do mesmo tenant —
 * cobre o caso em que o bot dono trocou de keys mas a tx velha continua
 * resolvendo com a credencial original.
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
async function listTenantCredentials(db, tenantId) {
    const { data: bots } = await db
        .from("bots")
        .select("sigilopay_public_key, sigilopay_secret_key")
        .eq("tenant_id", tenantId)
        .not("sigilopay_public_key", "is", null)
        .not("sigilopay_secret_key", "is", null);
    if (!bots)
        return [];
    const seen = new Set();
    const out = [];
    for (const b of bots) {
        if (!b.sigilopay_public_key || !b.sigilopay_secret_key)
            continue;
        const k = `${b.sigilopay_public_key}::${b.sigilopay_secret_key}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push({ publicKey: b.sigilopay_public_key, secretKey: b.sigilopay_secret_key });
    }
    return out;
}
export async function pollPoseidonPendingTransactions(db) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pending } = await db
        .from("transactions")
        .select("id, bot_id, tenant_id, external_id, created_at")
        .eq("gateway", "sigilopay")
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
            console.log(`[poseidon-poller] Tenant ${tenantId} sem credenciais Poseidon, pulando ${txs.length} txs`);
            continue;
        }
        for (const tx of txs) {
            try {
                let found = null;
                for (const cred of credentials) {
                    const sp = new SigiloPay(cred.publicKey, cred.secretKey);
                    const r = await sp.getPaymentStatus(tx.external_id);
                    if (r) {
                        found = r;
                        break;
                    }
                }
                if (!found) {
                    // Não é erro — pode ser que a Poseidon ainda não aprovou ou
                    // que o endpoint de consulta não existe na conta dele.
                    continue;
                }
                const status = found.status.toUpperCase();
                if (!["APPROVED", "OK", "COMPLETED", "PAID", "SUCCESS", "EXPIRED", "FAILED", "REFUNDED", "CANCELED", "CANCELLED"].includes(status)) {
                    // Ainda pending na Poseidon — segue tentando
                    continue;
                }
                console.log(`[poseidon-poller] tx ${tx.external_id} status=${status} — disparando pipeline`);
                const { processPaymentCallback } = await import("../webhook/payment.js");
                await processPaymentCallback(tx.bot_id, {
                    transactionId: tx.external_id,
                    status,
                });
                lastPolledAt.delete(tx.id);
            }
            catch (err) {
                console.error(`[poseidon-poller] Erro processando tx ${tx.external_id}:`, err);
            }
        }
    }
}
