import { Api } from "telegram";
import type { ClonePeer, SourceMessage } from "./types.js";
/**
 * Fonte do histórico. Existe para manter o iterador testável sem rede: a
 * implementação real embrulha client.iterMessages(peer, { reverse: true }).
 */
export interface HistorySource {
    fetch(sinceMsgId: number): AsyncIterable<unknown>;
    delay(ms: number): Promise<void>;
}
export declare function buildHistoryPeer(peer: ClonePeer): Api.TypeInputPeer;
/**
 * Normaliza um item cru do iterMessages. MessageService e MessageEmpty são
 * ruído estrutural (entrou no grupo, trocou foto, mensagem apagada) e saem
 * como null — o runner nunca os vê.
 */
export declare function normalizeMessage(raw: unknown): SourceMessage | null;
/**
 * Percorre o histórico do mais antigo para o mais novo, retomável a partir de
 * sinceMsgId.
 *
 * ARMADILHA: o waitTime do gramjs é no-op (requestIter.js:49-52 entrega
 * segundos para sleep(ms)). O throttle é imposto aqui.
 */
export declare function iterHistoryAscending(source: HistorySource, opts?: {
    sinceMsgId?: number;
    throttleMs?: number;
}): AsyncGenerator<SourceMessage, void, void>;
