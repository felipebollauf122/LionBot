interface PushPayload {
    title: string;
    body: string;
    url?: string;
    tag?: string;
}
/** Send a push payload to every device a tenant has subscribed. */
export declare function sendPushToTenant(tenantId: string, payload: PushPayload): Promise<void>;
/** Convenience: notify the tenant that a sale was approved.
 *  Mensagem enxuta: SÓ "Venda aprovada" + a quantia. NÃO recebe produto/bot de
 *  propósito — a notificação não deve expor nome de produto nem do bot. */
export declare function notifySale(tenantId: string, opts: {
    amount: number;
}): Promise<void>;
export {};
