import { findNextNodeId } from "./text.js";
export async function handleInputNode(ctx) {
    const prompt = String(ctx.node.data.prompt ?? "");
    const sent = await ctx.telegram.sendMessage({
        chatId: ctx.chatId,
        text: prompt,
    });
    return {
        nextNodeId: "wait",
        messageIds: sent ? [sent.message_id] : undefined,
    };
}
export function handleInputResponse(nodeId, variable, userResponse, edges) {
    return {
        nextNodeId: findNextNodeId(edges, nodeId),
        stateUpdates: { [variable]: userResponse },
    };
}
