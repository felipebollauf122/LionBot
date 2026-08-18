import type { NodeContext, NodeResult } from "../types.js";
import type { InlineKeyboardButton } from "../../telegram/api.js";

export async function handleButtonNode(ctx: NodeContext): Promise<NodeResult> {
  const text = String(ctx.node.data.text ?? "");
  const buttons = (ctx.node.data.buttons ?? []) as Array<{
    id?: string;
    text: string;
    action: string;
    value: string;
    product_id?: string;
  }>;

  const inlineKeyboard: InlineKeyboardButton[][] = buttons.map((btn, i) => {
    if (btn.action === "open_url") {
      return [{ text: btn.text, url: btn.value }];
    }
    if (btn.action === "payment") {
      // callback carrega só o id do botão — o produto é resolvido no
      // servidor a partir da config viva do nó (flow-processor.ts), nunca
      // confiado direto do cliente.
      const btnId = btn.id ?? `btn_idx_${i}`;
      return [{ text: btn.text, callback_data: `${ctx.node.id}:${btnId}` }];
    }
    return [{ text: btn.text, callback_data: `${ctx.node.id}:${btn.value}` }];
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
