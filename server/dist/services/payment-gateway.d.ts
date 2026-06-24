export interface CreatePixPaymentParams {
    identifier: string;
    amount: number;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    clientDocument: string;
    products?: Array<{
        id: string;
        name: string;
        description?: string;
        quantity: number;
        price: number;
    }>;
    callbackUrl: string;
    metadata?: Record<string, string>;
}
export interface PixPaymentResult {
    transactionId: string;
    status: string;
    pixCode: string;
    pixImage: string | null;
    orderId: string;
}
export interface PaymentGateway {
    isConfigured(): boolean;
    createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult>;
}
