import { findNextNodeId } from "./text.js";
function isValidMediaRef(value) {
    const v = value.trim();
    if (!v)
        return false;
    if (v === "undefined" || v === "null")
        return false;
    if (/^https?:\/\/\S+/i.test(v))
        return true;
    if (/^[A-Za-z0-9_-]{20,}$/.test(v))
        return true;
    return false;
}
export async function handleVideoNode(ctx) {
    const video = String(ctx.node.data.video_url ?? "");
    const caption = ctx.node.data.caption ? String(ctx.node.data.caption) : undefined;
    const next = findNextNodeId(ctx.edges, ctx.node.id);
    if (!isValidMediaRef(video)) {
        console.warn(`[video-node] node=${ctx.node.id} pulado: video_url inválido (valor=${JSON.stringify(video)}).`);
        return { nextNodeId: next };
    }
    const sent = await ctx.telegram.sendVideo({
        chatId: ctx.chatId,
        video,
        caption,
    });
    return {
        nextNodeId: next,
        messageIds: sent ? [sent.message_id] : undefined,
    };
}
