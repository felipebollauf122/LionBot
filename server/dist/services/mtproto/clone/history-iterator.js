import { Api } from "telegram";
import bigInt from "big-integer";
export function buildHistoryPeer(peer) {
    if (peer.peerType === "chat") {
        // Grupo legacy não tem access_hash.
        return new Api.InputPeerChat({ chatId: bigInt(peer.peerId) });
    }
    if (!peer.accessHash)
        throw new Error("CHANNEL_PEER_MISSING_ACCESS_HASH");
    return new Api.InputPeerChannel({
        channelId: bigInt(peer.peerId),
        accessHash: bigInt(peer.accessHash),
    });
}
/**
 * Normaliza um item cru do iterMessages. MessageService e MessageEmpty são
 * ruído estrutural (entrou no grupo, trocou foto, mensagem apagada) e saem
 * como null — o runner nunca os vê.
 */
export function normalizeMessage(raw) {
    if (!(raw instanceof Api.Message))
        return null;
    const replyTo = raw.replyTo;
    const isForumTopicReply = replyTo instanceof Api.MessageReplyHeader && replyTo.forumTopic === true;
    return {
        id: raw.id,
        groupedId: raw.groupedId ? raw.groupedId.toString() : null,
        replyToMsgId: replyTo instanceof Api.MessageReplyHeader && typeof replyTo.replyToMsgId === "number"
            ? replyTo.replyToMsgId
            : null,
        // replyToTopId é a raiz do tópico; ausente quando a msg responde
        // DIRETO à raiz (aí replyToMsgId já É a raiz) — replyToTopId ??
        // replyToMsgId cobre os dois casos. Sem forumTopic=true no header, não é
        // mensagem de tópico (General, ou canal sem fórum): topicId null.
        topicId: isForumTopicReply
            ? (replyTo.replyToTopId ??
                replyTo.replyToMsgId ??
                null)
            : null,
        raw,
    };
}
/**
 * Percorre o histórico do mais antigo para o mais novo, retomável a partir de
 * sinceMsgId.
 *
 * ARMADILHA: o waitTime do gramjs é no-op (requestIter.js:49-52 entrega
 * segundos para sleep(ms)). O throttle é imposto aqui.
 */
export async function* iterHistoryAscending(source, opts = {}) {
    const { sinceMsgId = 0, throttleMs = 1000 } = opts;
    for await (const raw of source.fetch(sinceMsgId)) {
        const m = normalizeMessage(raw);
        if (!m)
            continue;
        yield m;
        if (throttleMs > 0)
            await source.delay(throttleMs);
    }
}
