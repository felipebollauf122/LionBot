interface PushPayload {
    title: string;
    body: string;
    url?: string;
    tag?: string;
}
/** Send a push payload to every device a tenant has subscribed. */
export declare function sendPushToTenant(tenantId: string, payload: PushPayload): Promise<void>;
/** Convenience: notify the tenant that a sale was approved.
 *  Mensagem enxuta: SÓ "Venda aprovada" + a quantia (sem nome de produto/bot). */
export declare function notifySale(tenantId: string, opts: {
    amount: number;
    productName?: string | null;
    botName?: string | null;
}): Promise<void>;
export {};
