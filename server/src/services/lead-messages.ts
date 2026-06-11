import { supabase } from "../db.js";

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

async function insert(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("lead_messages").insert(row);
  if (error) {
    // Não relança — registro de chat não pode quebrar o fluxo do bot.
    console.error("[lead-messages] insert failed:", error.message);
  }
}

/** Texto que o LEAD mandou. */
export function logIncoming(
  ctx: BaseCtx,
  text: string,
  tgMessageId?: number,
): void {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return; // ignora updates sem texto (foto/sticker no v1 texto-only)
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
export function logOutgoing(
  ctx: BaseCtx,
  text: string,
  tgMessageId?: number,
): void {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return;
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
export function logEvent(
  ctx: BaseCtx,
  eventType: EventType,
  text: string,
  eventData: Record<string, unknown> = {},
): void {
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
