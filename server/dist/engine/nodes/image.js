import { findNextNodeId } from "./text.js";
// Aceita: URL http(s) OU file_id do Telegram (alfanumérico+hifens+underscores,
// geralmente ~20+ chars). Rejeita string vazia, "undefined"/"null", texto puro
// (ex: "imagem"), e qualquer coisa que vai dar 'Wrong string length' no
// sendPhoto.
function isValidPhotoRef(value) {
    const v = value.trim();
    if (!v)
        return false;
    if (v === "undefined" || v === "null")
        return false;
    if (/^https?:\/\/\S+/i.test(v))
        return true;
    // file_id típico: 20+ chars, base64url-ish
    if (/^[A-Za-z0-9_-]{20,}$/.test(v))
        return true;
    return false;
}
export async function handleImageNode(ctx) {
    const photo = String(ctx.node.data.image_url ?? ctx.node.data.photo ?? "");
    const caption = ctx.node.data.caption ? String(ctx.node.data.caption) : undefined;
    const next = findNextNodeId(ctx.edges, ctx.node.id);
    if (!isValidPhotoRef(photo)) {
        console.warn(`[image-node] node=${ctx.node.id} pulado: image_url inválido (valor=${JSON.stringify(photo)}). Configure uma URL https:// ou um file_id válido no flow editor.`);
        return { nextNodeId: next };
    }
    const sent = await ctx.telegram.sendPhoto({
        chatId: ctx.chatId,
        photo,
        caption,
    });
    return {
        nextNodeId: next,
        messageIds: sent ? [sent.message_id] : undefined,
    };
}
