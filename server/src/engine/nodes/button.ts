import type { NodeContext, NodeResult } from "../types.js";
import type { InlineKeyboardButton, InlineKeyboardButtonStyle } from "../../telegram/api.js";

export async function handleButtonNode(ctx: NodeContext): Promise<NodeResult> {
  const text = String(ctx.node.data.text ?? "");
  const buttons = (ctx.node.data.buttons ?? []) as Array<{
    id?: string;
    text: string;
    action: string;
    value: string;
    product_id?: string;
    style?: InlineKeyboardButtonStyle;
  }>;

  const inlineKeyboard: InlineKeyboardButton[][] = buttons.map((btn, i) => {
    const style = btn.style || undefined;
    if (btn.action === "open_url") {
      return [{ text: btn.text, url: btn.value, style }];
    }
    if (btn.action === "payment") {
      // callback carrega só o id do botão — o produto é resolvido no
      // servidor a partir da config viva do nó (flow-processor.ts), nunca
      // confiado direto do cliente.
      const btnId = btn.id ?? `btn_idx_${i}`;
      return [{ text: btn.text, callback_data: `${ctx.node.id}:${btnId}`, style }];
    }
    return [{ text: btn.text, callback_data: `${ctx.node.id}:${btn.value}`, style }];
  });

  const sent = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text,
    replyMarkup: { inline_keyboard: inlineKeyboard },
  });

  return {
    nextNodeId: "wait",
    messageIds: sent ? [sent.message_id] : undefined,
  };
}
