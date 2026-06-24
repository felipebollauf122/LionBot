import { supabase } from "../db.js";
import { TelegramApi } from "../telegram/api.js";
import { LeadService } from "../services/lead-service.js";
import { addPurchaseEmailTimeoutJob } from "../queue.js";
import { completePurchase } from "../services/purchase-completer.js";
import { isBlacklisted } from "../services/blacklist.js";
import { botCache } from "../cache.js";
import { config } from "../config.js";
import { notifySale } from "../services/push.js";
import { logEvent } from "../services/lead-messages.js";
/** Texto padrão pedindo o e-mail (usado quando o bot não customiza). */
const DEFAULT_EMAIL_REQUEST_MESSAGE = "✅ <b>Pagamento confirmado!</b>\n\n" +
    "Antes de liberar seu acesso, preciso do seu <b>e-mail válido</b> para registrar sua compra.\n\n" +
    "⚠️ Use um e-mail que você acessa de verdade — em caso de qualquer problema com o produto " +
    "(não receber link, suporte, atualizações), é por ele que você vai ser atendido. " +
    "E-mail errado significa ficar sem suporte.\n\n" +
    "📩 <b>Manda seu e-mail aí:</b>";
const leadService = new LeadService(supabase);
/**
 * Extract transactionId and status from Poseidon Pay callback body.
 * Tenta vários campos comuns porque a Poseidon não documenta um payload
 * canônico — varia entre webhooks.
 *
 * Formatos conhecidos:
 *  { transactionId, status }
 *  { id, status }
 *  { event: "payment.approved", data: { transactionId, status } }
 *  { transaction: { id, status } }
 *  { order: { id, status } }
 *  { data: { transaction: { id, status } } }
 */
function extractPaymentFields(body) {
    const data = (body.data ?? {});
    const order = (body.order ?? data.order ?? {});
    const transaction = (body.transaction ?? data.transaction ?? {});
    const transactionId = String(body.transactionId ??
        body.transaction_id ??
        body.id ??
        data.transactionId ??
        data.transaction_id ??
        data.id ??
        transaction.id ??
        transaction.transactionId ??
        order.id ??
        order.transactionId ??
        "") || undefined;
    // Se vier no formato { event: "payment.approved" }, extrai o status do evento
    const event = String(body.event ?? body.eventName ?? data.event ?? "").toLowerCase();
    let statusFromEvent;
    if (event.includes("paid") || event.includes("approved") || event.includes("completed")) {
        statusFromEvent = "PAID";
    }
    else if (event.includes("refund")) {
        statusFromEvent = "REFUNDED";
    }
    else if (event.includes("fail") || event.includes("reject") || event.includes("expir")) {
        statusFromEvent = "FAILED";
    }
    const status = String(body.status ??
        data.status ??
        transaction.status ??
        order.status ??
        statusFromEvent ??
        "") || undefined;
    return { transactionId, status };
}
/**
 * Core payment processing logic — can be called from either the payment
 * endpoint or redirected from the Telegram endpoint.
 */
export async function processPaymentCallback(botId, body) {
    console.log(`[payment-webhook] Processing callback (botId=${botId ?? "global"}):`, JSON.stringify(body));
    const { transactionId, status } = extractPaymentFields(body);
    if (!transactionId || !status) {
        console.error("[payment-webhook] Missing transactionId or status. Fields found:", { transactionId, status });
        return;
    }
    console.log(`[payment-webhook] Extracted: transactionId=${transactionId}, status=${status}`);
    // Lookup transaction by external_id — optionally scoped to botId
    let transaction = null;
    if (botId) {
        const { data: txByExternal } = await supabase
            .from("transactions")
            .select("*")
            .eq("external_id", transactionId)
            .eq("bot_id", botId)
            .maybeSingle();
        if (txByExternal) {
            transaction = txByExternal;
        }
    }
    // Fallback: lookup without bot_id filter (covers global webhook + legacy)
    if (!transaction) {
        const { data: txByExternalAny } = await supabase
            .from("transactions")
            .select("*")
            .eq("external_id", transactionId)
            .maybeSingle();
        if (txByExternalAny) {
            transaction = txByExternalAny;
        }
    }
    if (!transaction) {
        console.error(`[payment-webhook] Transaction not found for external_id: ${transactionId}`);
        return;
    }
    // Map gateway status to our status (case-insensitive).
    // PAID_OUT é o status de "pago" do Yvepay; os demais cobrem SigiloPay e
    // variações comuns.
    const normalizedStatus = String(status).toUpperCase();
    let newStatus;
    if (["OK", "COMPLETED", "APPROVED", "SUCCESS", "PAID", "PAID_OUT", "PAIDOUT"].includes(normalizedStatus)) {
        newStatus = "approved";
    }
    else if (["FAILED", "REJECTED", "ERROR", "EXPIRED", "REFUSED"].includes(normalizedStatus)) {
        newStatus = "refused";
    }
    else if (["CANCELED", "REFUNDED", "CANCELLED", "REVERSAL", "REVERSED", "CHARGEBACK"].includes(normalizedStatus)) {
        newStatus = "refunded";
    }
    else if (["PENDING", "PROCESSING", "WAITING", "CREATED", "PROCESSING_PAYMENT"].includes(normalizedStatus)) {
        console.log(`[payment-webhook] Status is ${status}, no action needed`);
        return;
    }
    else {
        console.log(`[payment-webhook] Unknown status: ${status} — ignoring`);
        return;
    }
    console.log(`[payment-webhook] Mapped status: ${status} → ${newStatus}`);
    // Idempotency early-check
    if (transaction.status === newStatus) {
        console.log(`[payment-webhook] Transaction ${transactionId} already ${newStatus}, skipping`);
        return;
    }
    // Lock atômico via CAS: o UPDATE só dispara se o status no DB AINDA
    // estiver no valor que lemos. Garante que webhook duplicado + poller
    // concorrente não cheguem juntos no completePurchase.
    const prevStatus = transaction.status;
    const { data: updated, error: updErr } = await supabase
        .from("transactions")
        .update({
        status: newStatus,
        paid_at: newStatus === "approved" ? new Date().toISOString() : null,
    })
        .eq("id", transaction.id)
        .eq("status", prevStatus)
        .select("id");
    if (updErr) {
        console.error(`[payment-webhook] update tx ${transaction.id} failed:`, updErr);
        return;
    }
    if (!updated || updated.length === 0) {
        console.log(`[payment-webhook] Transaction ${transaction.id} já foi processada por outro evento (CAS lost) — skip`);
        return;
    }
    console.log(`[payment-webhook] Transaction ${transaction.id} updated to ${newStatus}`);
    // Only process approved payments further
    if (newStatus !== "approved")
        return;
    // Fetch bot config (cached) + lead em PARALELO (#35) — leituras
    // independentes. Não toca em nenhuma lógica de status/segurança.
    const cachedBot = botCache.get(transaction.bot_id);
    const [botData, lead] = await Promise.all([
        cachedBot
            ? Promise.resolve(null) // já temos do cache, não busca
            : supabase.from("bots").select("*").eq("id", transaction.bot_id).single().then((r) => r.data),
        leadService.getById(transaction.lead_id),
    ]);
    let bot = cachedBot;
    if (!bot) {
        if (!botData)
            return;
        bot = botData;
        botCache.set(transaction.bot_id, botData);
    }
    // Push de venda para os dispositivos do tenant + marco na timeline do
    // chat (aba Clientes) — fire-and-forget, nunca bloqueia nem quebra o
    // fluxo de pagamento (push desativa sozinho se as chaves VAPID não setadas).
    void (async () => {
        try {
            const { data: prod } = await supabase
                .from("products")
                .select("name")
                .eq("id", transaction.product_id)
                .single();
            const productName = prod?.name ?? null;
            await notifySale(transaction.tenant_id, {
                amount: transaction.amount,
                productName,
                botName: bot.bot_username ?? null,
            });
            logEvent({
                leadId: transaction.lead_id,
                botId: transaction.bot_id,
                tenantId: transaction.tenant_id,
            }, "payment_approved", productName ? `Pagou: ${productName}` : "Pagamento aprovado", { amount: transaction.amount, product_name: productName });
        }
        catch (err) {
            console.error("[push] notifySale failed:", err.message);
        }
    })();
    if (!lead)
        return;
    const typedLead = lead;
    // Atualiza state: paid = true (mantém o resto)
    const baseState = { ...typedLead.state, paid: true };
    await leadService.updateState(typedLead.id, baseState);
    typedLead.state = baseState;
    // Blacklist: pagamento pode estar approved no DB pra contabilidade,
    // mas NÃO envia "Pagamento confirmado" no Telegram, NÃO retoma flow,
    // NÃO pede email. Silêncio total — mesma lógica das outras vias.
    if (await isBlacklisted(supabase, transaction.bot_id, typedLead.telegram_user_id)) {
        console.log(`[blacklist] Skipping post-payment flow for lead ${typedLead.id} (tx ${transaction.id})`);
        return;
    }
    // Toggle: bot pode pular a coleta de email e disparar Purchase imediato.
    if (bot.collect_email_after_payment) {
        // Modo "pedir email": marca pending_email_tx_id, pede email no Telegram,
        // agenda timeout. Purchase + Utmify só disparam quando o cliente
        // responder (ou após 2h).
        const stateWithPending = { ...baseState, pending_email_tx_id: transaction.id };
        await leadService.updateState(typedLead.id, stateWithPending);
        typedLead.state = stateWithPending;
        const telegram = new TelegramApi(bot.telegram_token, { protectContent: bot.protect_content });
        // Mensagem customizável pelo owner; cai no padrão se vazia.
        const emailMessage = bot.email_request_message && bot.email_request_message.trim().length > 0
            ? bot.email_request_message
            : DEFAULT_EMAIL_REQUEST_MESSAGE;
        await telegram.sendMessage({
            chatId: typedLead.telegram_user_id,
            text: emailMessage,
        });
        console.log(`[payment-webhook] Asked email from lead ${typedLead.id} (tx ${transaction.id})`);
        await addPurchaseEmailTimeoutJob({ leadId: typedLead.id, transactionId: transaction.id }, 2 * 60 * 60);
        return;
    }
    // Modo direto: dispara Purchase + libera produto na hora (sem coletar email).
    console.log(`[payment-webhook] collect_email disabled — completing purchase immediately for lead ${typedLead.id}`);
    await completePurchase(supabase, bot, typedLead, transaction);
}
/**
 * Express handler for /webhook/payment (global — single webhook for the entire platform).
 * Resolves the bot from the transaction record.
 */
export async function handlePaymentWebhookGlobal(req, res) {
    res.status(200).json({ ok: true });
    try {
        await processPaymentCallback(null, req.body);
    }
    catch (error) {
        console.error(`[payment-webhook] Error (global):`, error);
    }
}
/**
 * Express handler for /webhook/payment/:botId (legacy — kept for backwards compatibility
 * with webhooks already registered at SigiloPay).
 */
export async function handlePaymentWebhook(req, res) {
    const botId = String(req.params.botId);
    res.status(200).json({ ok: true });
    try {
        await processPaymentCallback(botId, req.body);
    }
    catch (error) {
        console.error(`[payment-webhook] Error for bot ${botId}:`, error);
    }
}
/**
 * Express handler for /webhook/evpay (EvPay gateway).
 * Valida assinatura HMAC-SHA256 (header X-Webhook-Signature) usando o
 * evpay_webhook_secret salvo no bot que originou a transação.
 */
export async function handleEvPayWebhook(req, res) {
    res.status(200).json({ ok: true });
    try {
        const body = (req.body ?? {});
        // Usa o buffer ORIGINAL pro HMAC — JSON.stringify reordenaria/normalizaria
        // bytes e a assinatura nunca bateria. Se rawBody não estiver presente
        // (caso o express.json não tenha guardado), cai pra stringify como
        // último recurso pra logs ainda funcionarem.
        const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(body);
        const signature = String(req.header("X-Webhook-Signature") ?? "");
        console.log(`[evpay-webhook] Received (sig=${signature ? "present" : "MISSING"}):`, rawBody);
        // Extrai transactionId do payload pra localizar a transação.
        //
        // FORMATO REAL do webhook Yvepay (confirmado em prod 2026-06-04):
        //   { idTransaction, typeTransaction:"QR_CODE_PAYMENT",
        //     statusTransaction:"PAID_OUT", value, key:"cmpy...",
        //     gatewayTransactionId:"cmpy...", endToEnd, ... }
        //
        // O nosso external_id é salvo a partir de payment.transactionId (o id que
        // o Yvepay devolveu na CRIAÇÃO do PIX) e bate com `key` /
        // `gatewayTransactionId` do webhook — NÃO com `idTransaction` (esse é o
        // id interno do PROCESSAMENTO, que não temos salvo). Por isso testamos
        // key/gatewayTransactionId PRIMEIRO. Mantemos os campos antigos
        // (transactionId/id/data.id) como fallback pra retrocompatibilidade.
        const data = (body.data ?? {});
        const transactionId = String(body.key ??
            body.gatewayTransactionId ??
            body.transactionId ??
            body.id ??
            body.idTransaction ??
            data.key ??
            data.gatewayTransactionId ??
            data.id ??
            data.transactionId ??
            "");
        if (!transactionId) {
            console.error(`[evpay-webhook] Missing transactionId in payload`);
            return;
        }
        const { data: tx } = await supabase
            .from("transactions")
            .select("bot_id")
            .eq("external_id", transactionId)
            .maybeSingle();
        if (!tx) {
            console.error(`[evpay-webhook] Transaction not found for external_id=${transactionId}`);
            return;
        }
        const { data: botRow } = await supabase
            .from("bots")
            .select("evpay_webhook_secret")
            .eq("id", tx.bot_id)
            .single();
        const secret = String(botRow?.evpay_webhook_secret ?? "");
        // Valida HMAC. Se EVPAY_REQUIRE_SIGNATURE=false (padrão), só loga warning
        // em caso de falha e segue processando — evita perder venda enquanto
        // a assinatura é calibrada. Em produção estável, defina EVPAY_REQUIRE_SIGNATURE=true.
        const { EvPay } = await import("../services/evpay.js");
        let signatureValid = false;
        if (secret && signature) {
            signatureValid = EvPay.verifySignature(rawBody, signature, secret);
        }
        if (!signatureValid) {
            const reason = !secret
                ? "no secret saved for bot"
                : !signature
                    ? "header X-Webhook-Signature missing"
                    : "HMAC mismatch";
            if (config.evpayRequireSignature) {
                console.error(`[evpay-webhook] Signature INVALID (${reason}) — REJECTING tx ${transactionId}`);
                return;
            }
            console.warn(`[evpay-webhook] Signature INVALID (${reason}) — processing anyway (EVPAY_REQUIRE_SIGNATURE=false)`);
        }
        else {
            console.log(`[evpay-webhook] Signature OK for tx ${transactionId}`);
        }
        // Status do pagamento. A Yvepay manda em `statusTransaction` (ex:
        // "PAID_OUT" = pago). Mantemos os formatos antigos (data.status,
        // body.status, type de evento pix.in.*) como fallback.
        //   PAID_OUT / PAID / APPROVED → aprovado (processPaymentCallback mapeia)
        //   EXPIRED / FAILED / REVERSAL → recusado/estornado
        const eventType = String(body.typeTransaction ?? body.type ?? body.event ?? "");
        let status = String(body.statusTransaction ??
            data.statusTransaction ??
            data.status ??
            body.status ??
            "");
        if (!status) {
            if (eventType === "pix.in.confirmation")
                status = "APPROVED";
            else if (eventType === "pix.in.expired")
                status = "EXPIRED";
            else if (eventType === "pix.in.failed")
                status = "FAILED";
            else if (eventType === "pix.in.reversal.confirmation")
                status = "REFUNDED";
        }
        console.log(`[evpay-webhook] type=${eventType} txn=${transactionId} status=${status}`);
        await processPaymentCallback(tx.bot_id, { transactionId, status });
    }
    catch (error) {
        console.error(`[evpay-webhook] Error:`, error);
    }
}
/**
 * Reentrega manual de uma transação (botão "Reenviar acesso" no painel).
 * Reexecuta o fluxo de pós-pagamento (edge "paid") pra reentregar produto/
 * mensagens ao cliente. O tracking (Facebook/Utmify) NÃO duplica — o
 * completePurchase respeita o flag sent_to_facebook.
 *
 * force=true ignora o guard delivered_tx pra realmente reentregar.
 * Respeita blacklist (silêncio total). Retorna o resultado pra o painel.
 */
export async function redeliverTransaction(transactionId) {
    const { data: txRow } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle();
    if (!txRow)
        return { ok: false, reason: "transaction_not_found" };
    const transaction = txRow;
    if (transaction.status !== "approved") {
        return { ok: false, reason: `status_not_approved (${transaction.status})` };
    }
    // Bot (cache → DB)
    let bot = botCache.get(transaction.bot_id);
    if (!bot) {
        const { data } = await supabase.from("bots").select("*").eq("id", transaction.bot_id).single();
        if (!data)
            return { ok: false, reason: "bot_not_found" };
        bot = data;
        botCache.set(transaction.bot_id, data);
    }
    const lead = await leadService.getById(transaction.lead_id);
    if (!lead)
        return { ok: false, reason: "lead_not_found" };
    const typedLead = lead;
    // Blacklist: silêncio total
    if (await isBlacklisted(supabase, transaction.bot_id, typedLead.telegram_user_id)) {
        return { ok: false, reason: "blacklisted" };
    }
    try {
        await completePurchase(supabase, bot, typedLead, transaction, { force: true });
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[redeliver] tx ${transactionId} falhou:`, msg);
        return { ok: false, reason: msg };
    }
}
