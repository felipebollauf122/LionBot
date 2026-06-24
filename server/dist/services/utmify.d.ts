interface UtmifyOrderParams {
    orderId: string;
    status: "paid" | "refunded" | "waiting_payment" | "refused";
    platform: string;
    paymentMethod: string;
    paidAt?: string;
    refundedAt?: string | null;
    customer: {
        name: string;
        email: string;
        phone: string;
        document: string;
        country?: string;
    };
    products: Array<{
        id: string;
        name: string;
        priceInCents: string;
        quantity: number;
        planId?: string;
        planName?: string;
    }>;
    approvedDate?: string | null;
    trackingParameters?: {
        src?: string | null;
        sck?: string | null;
        utm_source?: string | null;
        utm_medium?: string | null;
        utm_campaign?: string | null;
        utm_content?: string | null;
        utm_term?: string | null;
    };
    commission?: {
        totalPriceInCents: string;
        gatewayFeeInCents: string;
        userCommissionInCents: string;
    };
    isTest?: boolean;
}
export declare class UtmifyService {
    private apiToken;
    private baseUrl;
    constructor(apiToken: string);
    private isConfigured;
    sendOrder(params: UtmifyOrderParams): Promise<boolean>;
}
export {};
