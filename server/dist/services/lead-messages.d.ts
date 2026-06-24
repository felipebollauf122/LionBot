/**
 * Timeline de conversa bot<->lead (aba CLIENTES / chat ao vivo).
 *
 * Grava SÓ:
 *   - 'in'    : texto do lead (webhook)
 *   - 'out'   : texto do operador (endpoint send-message)
 *   - 'event' : marcos do funil (clique, PIX, pago, bloqueio)
 *
 * NÃO grava o que o bot automático dispara nos fluxos — engine fica intacto.
 *
 * Todas as funções são fire-and-forget: NUNCA travam nem derrubam o hot path
 * do webhook. Erro é só logado.
 */
type EventType = "button_click" | "pix_generated" | "payment_approved" | "blocked";
interface BaseCtx {
    leadId: string;
    botId: string;
    tenantId: string;
}
/** Texto que o LEAD mandou. */
export declare function logIncoming(ctx: BaseCtx, text: string, tgMessageId?: number): void;
/** Texto que o OPERADOR mandou pelo painel. */
export declare function logOutgoing(ctx: BaseCtx, text: string, tgMessageId?: number): void;
/** Marco do funil na timeline (clique, PIX, pago, bloqueio). */
export declare function logEvent(ctx: BaseCtx, eventType: EventType, text: string, eventData?: Record<string, unknown>): void;
export {};
