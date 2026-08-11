import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import {
  buildHistoryPeer,
  normalizeMessage,
  iterHistoryAscending,
  type HistorySource,
} from "../../src/services/mtproto/clone/history-iterator.js";

function msg(id: number, extra: Partial<Api.Message> = {}): Api.Message {
  return new Api.Message({ id, message: `m${id}`, ...extra } as never);
}

describe("buildHistoryPeer", () => {
  it("monta InputPeerChannel com accessHash", () => {
    const p = buildHistoryPeer({ peerId: "777", peerType: "channel", accessHash: "999" });
    expect(p).toBeInstanceOf(Api.InputPeerChannel);
    expect((p as Api.InputPeerChannel).channelId.toString()).toBe("777");
  });

  it("monta InputPeerChat sem accessHash", () => {
    const p = buildHistoryPeer({ peerId: "555", peerType: "chat", accessHash: null });
    expect(p).toBeInstanceOf(Api.InputPeerChat);
  });

  it("recusa canal sem accessHash", () => {
    expect(() =>
      buildHistoryPeer({ peerId: "777", peerType: "channel", accessHash: null }),
    ).toThrow(/CHANNEL_PEER_MISSING_ACCESS_HASH/);
  });
});

describe("normalizeMessage", () => {
  it("normaliza uma Api.Message", () => {
    const out = normalizeMessage(msg(10, { groupedId: bigInt(42) }));
    expect(out).toEqual({
      id: 10,
      groupedId: "42",
      replyToMsgId: null,
      topicId: null,
      raw: expect.anything(),
    });
  });

  it("lê o id da mensagem respondida", () => {
    const m = msg(11, { replyTo: new Api.MessageReplyHeader({ replyToMsgId: 5 } as never) });
    expect(normalizeMessage(m)?.replyToMsgId).toBe(5);
  });

  describe("topicId", () => {
    it("forumTopic com replyToTopId presente: topicId é a raiz do tópico", () => {
      const m = msg(20, {
        replyTo: new Api.MessageReplyHeader({
          forumTopic: true,
          replyToMsgId: 30,
          replyToTopId: 15,
        } as never),
      });
      expect(normalizeMessage(m)?.topicId).toBe(15);
    });

    it("forumTopic sem replyToTopId (resposta direta à raiz): cai pra replyToMsgId", () => {
      const m = msg(21, {
        replyTo: new Api.MessageReplyHeader({
          forumTopic: true,
          replyToMsgId: 15,
        } as never),
      });
      expect(normalizeMessage(m)?.topicId).toBe(15);
    });

    it("resposta comum sem forumTopic: topicId null, replyToMsgId preservado (independência)", () => {
      const m = msg(22, {
        replyTo: new Api.MessageReplyHeader({ replyToMsgId: 5 } as never),
      });
      const out = normalizeMessage(m);
      expect(out?.topicId).toBeNull();
      expect(out?.replyToMsgId).toBe(5);
    });

    it("sem replyTo nenhum: topicId null", () => {
      expect(normalizeMessage(msg(23))?.topicId).toBeNull();
    });
  });

  it("descarta MessageService e MessageEmpty", () => {
    expect(normalizeMessage(new Api.MessageEmpty({ id: 1 } as never))).toBeNull();
    expect(
      normalizeMessage(
        new Api.MessageService({
          id: 2,
          action: new Api.MessageActionChatCreate({ title: "x", users: [] } as never),
        } as never),
      ),
    ).toBeNull();
  });
});

describe("iterHistoryAscending", () => {
  it("rende em ordem crescente, pulando service, e aplica o throttle entre itens", async () => {
    // events registra a intercalação real entre consumo e delay. Um delay
    // "fire-and-forget" (sem await) reordenaria isso: os dois msg:N sairiam
    // antes dos dois delay:N, já que o setImmediate abaixo só resolve depois
    // do loop síncrono do gerador ter avançado até o fim. Só um await
    // genuíno produz msg,delay,msg,delay.
    const events: string[] = [];
    const delay = vi.fn(async (ms: number) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      events.push(`delay:${ms}`);
    });
    const source: HistorySource = {
      fetch: async function* () {
        yield msg(1);
        yield new Api.MessageService({
          id: 2,
          action: new Api.MessageActionChatCreate({ title: "x", users: [] } as never),
        } as never);
        yield msg(3);
      },
      delay,
    };

    const ids: number[] = [];
    for await (const m of iterHistoryAscending(source, { throttleMs: 1500 })) {
      ids.push(m.id);
      events.push(`msg:${m.id}`);
    }

    expect(ids).toEqual([1, 3]);
    // MessageService (id 2) é filtrado, então só 2 mensagens reais passam
    // pelo yield — e o throttle deve disparar exatamente 2 vezes, nunca 3.
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1500);
    expect(events).toEqual(["msg:1", "delay:1500", "msg:3", "delay:1500"]);
  });

  it("usa o throttle padrão de 1000ms quando throttleMs não é informado", async () => {
    const delay = vi.fn(async () => {});
    const source: HistorySource = {
      fetch: async function* () {
        yield msg(7);
      },
      delay,
    };

    const ids: number[] = [];
    for await (const m of iterHistoryAscending(source)) ids.push(m.id);

    expect(ids).toEqual([7]);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(1000);
  });

  it("repassa sinceMsgId para o fetch", async () => {
    const fetch = vi.fn(async function* () {});
    await (async () => {
      for await (const _ of iterHistoryAscending({ fetch, delay: async () => {} }, { sinceMsgId: 99 })) void _;
    })();
    expect(fetch).toHaveBeenCalledWith(99);
  });
});
