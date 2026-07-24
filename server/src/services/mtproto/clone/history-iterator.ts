import { Api } from "telegram";
import bigInt from "big-integer";
import type { ClonePeer, SourceMessage } from "./types.js";

/**
 * Fonte do histórico. Existe para manter o iterador testável sem rede: a
 * implementação real embrulha client.iterMessages(peer, { reverse: true }).
 */
export interface HistorySource {
  fetch(sinceMsgId: number): AsyncIterable<unknown>;
  delay(ms: number): Promise<void>;
}

export function buildHistoryPeer(peer: ClonePeer): Api.TypeInputPeer {
  if (peer.peerType === "chat") {
    // Grupo legacy não tem access_hash.
    return new Api.InputPeerChat({ chatId: bigInt(peer.peerId) });
  }
  if (!peer.accessHash) throw new Error("CHANNEL_PEER_MISSING_ACCESS_HASH");
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
export function normalizeMessage(raw: unknown): SourceMessage | null {
  if (!(raw instanceof Api.Message)) return null;
  const replyTo = raw.replyTo;
  return {
    id: raw.id,
    groupedId: raw.groupedId ? raw.groupedId.toString() : null,
    replyToMsgId:
      replyTo instanceof Api.MessageReplyHeader && typeof replyTo.replyToMsgId === "number"
        ? replyTo.replyToMsgId
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
export async function* iterHistoryAscending(
  source: HistorySource,
  opts: { sinceMsgId?: number; throttleMs?: number } = {},
): AsyncGenerator<SourceMessage, void, void> {
  const { sinceMsgId = 0, throttleMs = 1000 } = opts;
  for await (const raw of source.fetch(sinceMsgId)) {
    const m = normalizeMessage(raw);
    if (!m) continue;
    yield m;
    if (throttleMs > 0) await source.delay(throttleMs);
  }
}
