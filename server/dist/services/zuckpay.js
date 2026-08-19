import { createHmac } from "crypto";
/**
 * ZuckPay — gateway PIX.
 * Docs: https://www.zuckpay.com.br/conta/v3/...
 *
 * Modelo (híbrido entre os dois que já temos):
 *  - Auth Basic: base64(client_id:client_secret) no header Authorization (igual
 *    às chaves da SigiloPay irem no header).
 *  - Webhook informado no CORPO da criação via `urlnoty` (como a callbackUrl da
 *    SigiloPay) — NÃO é pré-registrado por projeto como o EvPay.
 *  - Webhook assinado com HMAC-SHA256 (header X-ZuckPay-Signature), como o EvPay.
 */
export class ZuckPay {
    clientId;
    clientSecret;
    baseUrl = "https://www.zuckpay.com.br/conta/v3";
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }
    isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }
    authHeader() {
        return "Basic " + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    }
    async createPixPayment(params) {
        if (!this.isConfigured()) {
            throw new Error("ZuckPay não configurado. Vá em Configurações do bot e preencha o Client ID e o Client Secret.");
        }
        // Descrição: usa o primeiro produto (name + description, se houver).
        // O caller já passa name=ghost_name||name e description=ghost_description||description.
        const firstProduct = params.products?.[0];
        const description = firstProduct
            ? firstProduct.description
                ? `${firstProduct.name} — ${firstProduct.description}`
                : firstProduct.name
            : `Pedido ${params.identifier}`;
        // ZuckPay usa "valor" (float com ponto), "nome", "cpf" (só números), etc.
        const payload = {
            nome: params.clientName,
            cpf: (params.clientDocument || "").replace(/\D/g, ""),
            valor: params.amount,
            email: params.clientEmail,
            telefone: (params.clientPhone || "").replace(/\D/g, ""),
            urlnoty: params.callbackUrl,
            descricao: description,
            external_id_client: params.identifier,
        };
        // Repassa parâmetros de atribuição (Meta/UTM) se vieram no metadata — a
        // ZuckPay aceita utm_*, fbc, fbp, fbclid etc. direto no body.
        const meta = params.metadata ?? {};
        for (const k of [
            "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
            "fbc", "fbp", "fbclid",
        ]) {
            const v = meta[k];
            if (v)
                payload[k] = v;
        }
        console.log(`[zuckpay] Creating PIX payment (client_id prefix="${this.clientId.slice(0, 8)}")`);
        console.log(`[zuckpay] Payload enviado:`, JSON.stringify(payload, null, 2));
        const response = await fetch(`${this.baseUrl}/pix/qrcode`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: this.authHeader(),
            },
            body: JSON.stringify(payload),
            // Timeout pra não pendurar a geração do PIX (e o cliente no Telegram)
            // caso a ZuckPay esteja lenta/rate-limitada.
            signal: AbortSignal.timeout(15_000),
        });
        const rawBody = (await response.json().catch(() => ({})));
        console.log(`[zuckpay] response status=${response.status} body=${JSON.stringify(rawBody)}`);
        if (!response.ok) {
            const msg = rawBody.message ??
                rawBody.error ??
                response.statusText ??
                "erro desconhecido";
            console.error(`[zuckpay] createPixPayment failed (${response.status}):`, msg);
            throw new Error(`ZuckPay erro (${response.status}): ${msg}`);
        }
        // A resposta pode vir flat ({...}) ou aninhada em {data:{...}}.
        const data = (rawBody.data &&
            typeof rawBody.data === "object"
            ? rawBody.data
            : rawBody) ?? {};
        const transactionId = String(data.transactionId ??
            data.transaction_id ??
            data.id ??
            "");
        const status = String(data.status ?? "PENDING");
        // BRcode / copia-e-cola: docs trazem "qrcode" e "pix_code" (mesmo valor).
        const pixCode = String(data.pix_code ??
            data.qrcode ??
            data.pixCode ??
            data.brCode ??
            "");
        const pixImage = String(data.qrcode_image ?? data.qrcodeImage ?? "") || null;
        const externalId = String(data.external_id ??
            data.external_id_client ??
            "");
        if (!transactionId) {
            console.error(`[zuckpay] response missing transaction id. body:`, JSON.stringify(rawBody));
            throw new Error(`ZuckPay devolveu resposta sem id de transação. Verifique client_id/client_secret.`);
        }
        if (!pixCode) {
            console.error(`[zuckpay] response missing pix code. body:`, JSON.stringify(rawBody));
            throw new Error(`ZuckPay devolveu resposta sem código PIX.`);
        }
        console.log(`[zuckpay] PIX created, txn ${transactionId}`);
        return {
            transactionId,
            status,
            pixCode,
            pixImage,
            orderId: externalId || transactionId,
        };
    }
    /**
     * Consulta o status atual de uma transação. Usado pelo poller pra detectar
     * pagamentos quando o webhook não chega.
     * GET /pix/status?transactionId=ID → { status: PAID|PENDING|... }
     */
    async getPaymentStatus(transactionId) {
        if (!this.isConfigured())
            return null;
        try {
            const response = await fetch(`${this.baseUrl}/pix/status?transactionId=${encodeURIComponent(transactionId)}`, {
                method: "GET",
                headers: { Accept: "application/json", Authorization: this.authHeader() },
                // Timeout obrigatório: sem ele uma conexão pendurada (rate-limit)
                // fica presa no pool do undici e envenena as próximas chamadas.
                signal: AbortSignal.timeout(10_000),
            });
            if (response.status === 404)
                return null;
            const body = (await response.json().catch(() => ({})));
            if (!response.ok) {
                console.error(`[zuckpay] getPaymentStatus(${transactionId}) failed (${response.status}): ${body.message ?? response.statusText}`);
                return null;
            }
            const status = String(body.status ?? body.data?.status ?? "");
            if (!status)
                return null;
            return { status };
        }
        catch (err) {
            console.warn(`[zuckpay] getPaymentStatus(${transactionId}) erro:`, err);
            return null;
        }
    }
    /**
     * Valida o header X-ZuckPay-Signature (HMAC-SHA256 hex do raw body com o secret).
     * Mesma mecânica do EvPay.
     */
    static verifySignature(rawBody, signature, secret) {
        if (!signature || !secret)
            return false;
        const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
        if (expected.length !== signature.length)
            return false;
        let mismatch = 0;
        for (let i = 0; i < expected.length; i++) {
            mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
        }
        return mismatch === 0;
    }
}
