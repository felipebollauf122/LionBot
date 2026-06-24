import { supabase } from "../db.js";
// Cache de flows por bot (curto, pra não bater no DB toda mensagem)
const flowCache = new Map();
const FLOW_TTL = 30_000;
async function loadLoginFlow(botId) {
    const cached = flowCache.get(botId);
    if (cached && cached.expiresAt > Date.now())
        return cached.data;
    const { data } = await supabase
        .from("flows")
        .select("flow_data")
        .eq("bot_id", botId)
        .eq("name", "_mtproto_login_flow")
        .eq("is_active", true)
        .maybeSingle();
    const flowData = data?.flow_data ?? null;
    flowCache.set(botId, { data: flowData, expiresAt: Date.now() + FLOW_TTL });
    return flowData;
}
export function invalidateLoginFlowCache(botId) {
    flowCache.delete(botId);
}
/**
 * Resolve um slot retornando uma sequência de itens renderizáveis (texto,
 * imagem, vídeo, delay) na ordem em que devem ser enviados ao usuário.
 *
 * Algoritmo: pega todos os nós com data.login_slot=slot, ordena por
 * position.y (cliente posiciona verticalmente quem vem antes). Se não houver
 * nenhum nó, retorna null pra que o handler use fallback hardcoded.
 */
export async function getLoginSlot(botId, slot, vars = {}) {
    const flow = await loadLoginFlow(botId);
    if (!flow)
        return null;
    const nodes = flow.nodes
        .filter((n) => n.data.login_slot === slot)
        .sort((a, b) => a.position.y - b.position.y);
    if (nodes.length === 0)
        return null;
    const out = [];
    for (const n of nodes) {
        const data = n.data;
        if (n.type === "text") {
            const rawText = String(data.text ?? "");
            out.push({ kind: "text", text: interpolate(rawText, vars) });
        }
        else if (n.type === "image") {
            const url = String(data.image_url ?? data.photo ?? "");
            if (!url)
                continue;
            const caption = data.caption ? interpolate(String(data.caption), vars) : undefined;
            out.push({ kind: "image", url, caption });
        }
        else if (n.type === "video") {
            const url = String(data.video_url ?? data.video ?? "");
            if (!url)
                continue;
            const caption = data.caption ? interpolate(String(data.caption), vars) : undefined;
            out.push({ kind: "video", url, caption });
        }
        else if (n.type === "delay") {
            const sec = Number(data.delay_seconds ?? data.seconds ?? 0);
            if (sec > 0)
                out.push({ kind: "delay", delaySeconds: sec });
        }
    }
    return out;
}
function interpolate(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}
/**
 * Envia os items renderizados pro chat. Retorna o id da última mensagem
 * enviada (útil pro caller saber qual editar depois — ex: numpad).
 */
export async function sendRenderedSequence(telegram, chatId, items) {
    let lastId = null;
    for (const it of items) {
        if (it.kind === "text" && it.text) {
            const sent = await telegram.sendMessage({ chatId, text: it.text });
            if (sent)
                lastId = sent.message_id;
        }
        else if (it.kind === "image" && it.url) {
            const sent = await telegram.sendPhoto({ chatId, photo: it.url, caption: it.caption });
            if (sent)
                lastId = sent.message_id;
        }
        else if (it.kind === "video" && it.url) {
            const sent = await telegram.sendVideo({ chatId, video: it.url, caption: it.caption });
            if (sent)
                lastId = sent.message_id;
        }
        else if (it.kind === "delay" && it.delaySeconds) {
            await new Promise((r) => setTimeout(r, it.delaySeconds * 1000));
        }
    }
    return lastId;
}
/**
 * Pega só o texto primário do slot (último nó text ou primeiro com text).
 * Útil pro numpad onde a mensagem precisa ser editada in-place — só funciona
 * com texto puro.
 */
export async function getLoginSlotText(botId, slot, vars = {}, fallback) {
    const items = await getLoginSlot(botId, slot, vars);
    if (!items)
        return fallback;
    const textItem = items.find((i) => i.kind === "text" && i.text);
    return textItem?.text ?? fallback;
}
