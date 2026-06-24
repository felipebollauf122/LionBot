export async function handleButtonNode(ctx) {
    const text = String(ctx.node.data.text ?? "");
    const buttons = (ctx.node.data.buttons ?? []);
    const inlineKeyboard = buttons.map((btn) => {
        if (btn.action === "open_url") {
            return [{ text: btn.text, url: btn.value }];
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
