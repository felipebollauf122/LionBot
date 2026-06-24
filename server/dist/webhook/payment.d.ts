import type { Request, Response } from "express";
/**
 * Core payment processing logic — can be called from either the payment
 * endpoint or redirected from the Telegram endpoint.
 */
export declare function processPaymentCallback(botId: string | null, body: Record<string, unknown>): Promise<void>;
/**
 * Express handler for /webhook/payment (global — single webhook for the entire platform).
 * Resolves the bot from the transaction record.
 */
export declare function handlePaymentWebhookGlobal(req: Request, res: Response): Promise<void>;
/**
 * Express handler for /webhook/payment/:botId (legacy — kept for backwards compatibility
 * with webhooks already registered at SigiloPay).
 */
export declare function handlePaymentWebhook(req: Request, res: Response): Promise<void>;
/**
 * Express handler for /webhook/evpay (EvPay gateway).
 * Valida assinatura HMAC-SHA256 (header X-Webhook-Signature) usando o
 * evpay_webhook_secret salvo no bot que originou a transação.
 */
export declare function handleEvPayWebhook(req: Request & {
    rawBody?: Buffer;
}, res: Response): Promise<void>;
/**
 * Reentrega manual de uma transação (botão "Reenviar acesso" no painel).
 * Reexecuta o fluxo de pós-pagamento (edge "paid") pra reentregar produto/
 * mensagens ao cliente. O tracking (Facebook/Utmify) NÃO duplica — o
 * completePurchase respeita o flag sent_to_facebook.
 *
 * force=true ignora o guard delivered_tx pra realmente reentregar.
 * Respeita blacklist (silêncio total). Retorna o resultado pra o painel.
 */
export declare function redeliverTransaction(transactionId: string): Promise<{
    ok: boolean;
    reason?: string;
}>;
