import type { CreatePixPaymentParams, PaymentGateway, PixPaymentResult } from "./payment-gateway.js";
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
export declare class ZuckPay implements PaymentGateway {
    private clientId;
    private clientSecret;
    private baseUrl;
    constructor(clientId: string, clientSecret: string);
    isConfigured(): boolean;
    private authHeader;
    createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult>;
    /**
     * Consulta o status atual de uma transação. Usado pelo poller pra detectar
     * pagamentos quando o webhook não chega.
     * GET /pix/status?transactionId=ID → { status: PAID|PENDING|... }
     */
    getPaymentStatus(transactionId: string): Promise<{
        status: string;
    } | null>;
    /**
     * Valida o header X-ZuckPay-Signature (HMAC-SHA256 hex do raw body com o secret).
     * Mesma mecânica do EvPay.
     */
    static verifySignature(rawBody: string, signature: string, secret: string): boolean;
}
