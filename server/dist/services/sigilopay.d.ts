import type { CreatePixPaymentParams, PaymentGateway, PixPaymentResult } from "./payment-gateway.js";
export declare class SigiloPay implements PaymentGateway {
    private publicKey;
    private secretKey;
    private baseUrl;
    constructor(publicKey: string, secretKey: string);
    isConfigured(): boolean;
    createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult>;
    /**
     * Consulta status atual de uma transação. Usado pelo poller pra
     * verificar pagamentos quando o webhook automático não chega.
     *
     * Como a Poseidon não documenta um endpoint canônico, tenta os mais
     * prováveis em ordem: /gateway/pix/{id}, /gateway/transactions/{id},
     * /gateway/order/{id}. Retorna null se nenhum bater (404) ou se houver
     * erro de auth/rede.
     */
    getPaymentStatus(externalId: string): Promise<{
        status: string;
    } | null>;
}
