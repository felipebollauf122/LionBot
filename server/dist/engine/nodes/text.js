function interpolate(template, lead) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (key in lead) {
            return String(lead[key] ?? "");
        }
        if (lead.state && key in lead.state) {
            return String(lead.state[key] ?? "");
        }
        return "";
    });
}
export function findNextNodeId(edges, currentNodeId, handle) {
    const edge = edges.find((e) => e.source === currentNodeId && (handle ? e.sourceHandle === handle : true));
    return edge?.target ?? null;
}
export async function handleTextNode(ctx) {
    const text = interpolate(String(ctx.node.data.text ?? ""), ctx.lead);
    const sent = await ctx.telegram.sendMessage({
        chatId: ctx.chatId,
        text,
    });
    return {
        nextNodeId: findNextNodeId(ctx.edges, ctx.node.id),
        messageIds: sent ? [sent.message_id] : undefined,
    };
}
