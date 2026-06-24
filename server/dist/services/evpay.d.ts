import type { CreatePixPaymentParams, PaymentGateway, PixPaymentResult } from "./payment-gateway.js";
export declare class EvPay implements PaymentGateway {
    private apiKey;
    private projectId;
    private baseUrl;
    constructor(apiKey: string, projectId: string);
    isConfigured(): boolean;
    createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult>;
    /**
     * Registra (ou re-registra) o webhook no EvPay.
     * Idempotente: se já existir webhook com a mesma URL, EvPay devolve 409;
     * tratamos como sucesso.
     */
    registerWebhook(url: string, secret: string): Promise<{
        webhookId: string | null;
    }>;
    /**
     * Consulta o status atual de uma transação. Usado pelo poller pra
     * detectar pagamentos quando o webhook automático não dispara.
     */
    getPaymentStatus(transactionId: string): Promise<{
        status: string;
    } | null>;
    /**
     * Lista webhooks registrados no projeto. Útil pra diagnóstico —
     * checa se o nosso URL realmente está cadastrado.
     */
    listWebhooks(): Promise<Array<{
        id: string;
        url: string;
        events: string[];
        isActive: boolean;
    }>>;
    /**
     * Apaga um webhook do projeto pelo id. Usado quando a URL cadastrada está
     * errada (ex: domínio antigo) e precisamos re-registrar com a URL correta.
     */
    deleteWebhook(webhookId: string): Promise<boolean>;
    /**
     * Valida o header X-Webhook-Signature (HMAC-SHA256 hex do raw body com o secret).
     */
    static verifySignature(rawBody: string, signature: string, secret: string): boolean;
}
