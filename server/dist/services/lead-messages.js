import { supabase } from "../db.js";
async function insert(row) {
    const { error } = await supabase.from("lead_messages").insert(row);
    if (error) {
        // Não relança — registro de chat não pode quebrar o fluxo do bot.
        console.error("[lead-messages] insert failed:", error.message);
    }
}
/** Texto que o LEAD mandou. */
export function logIncoming(ctx, text, tgMessageId) {
    const trimmed = (text ?? "").trim();
    if (!trimmed)
        return; // ignora updates sem texto (foto/sticker no v1 texto-only)
    void insert({
        lead_id: ctx.leadId,
        bot_id: ctx.botId,
        tenant_id: ctx.tenantId,
        direction: "in",
        text: trimmed,
        tg_message_id: tgMessageId ?? null,
    });
}
/** Texto que o OPERADOR mandou pelo painel. */
export function logOutgoing(ctx, text, tgMessageId) {
    const trimmed = (text ?? "").trim();
    if (!trimmed)
        return;
    void insert({
        lead_id: ctx.leadId,
        bot_id: ctx.botId,
        tenant_id: ctx.tenantId,
        direction: "out",
        text: trimmed,
        sent_by: "operator",
        tg_message_id: tgMessageId ?? null,
    });
}
/** Marco do funil na timeline (clique, PIX, pago, bloqueio). */
export function logEvent(ctx, eventType, text, eventData = {}) {
    void insert({
        lead_id: ctx.leadId,
        bot_id: ctx.botId,
        tenant_id: ctx.tenantId,
        direction: "event",
        event_type: eventType,
        text,
        event_data: eventData,
    });
}
