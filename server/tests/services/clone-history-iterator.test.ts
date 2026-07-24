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
    expect(out).toEqual({ id: 10, groupedId: "42", replyToMsgId: null, raw: expect.anything() });
  });

  it("lê o id da mensagem respondida", () => {
    const m = msg(11, { replyTo: new Api.MessageReplyHeader({ replyToMsgId: 5 } as never) });
    expect(normalizeMessage(m)?.replyToMsgId).toBe(5);
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
    const delay = vi.fn(async () => {});
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
    for await (const m of iterHistoryAscending(source, { throttleMs: 1500 })) ids.push(m.id);

    expect(ids).toEqual([1, 3]);
    expect(delay).toHaveBeenCalledWith(1500);
  });

  it("repassa sinceMsgId para o fetch", async () => {
    const fetch = vi.fn(async function* () {});
    await (async () => {
      for await (const _ of iterHistoryAscending({ fetch, delay: async () => {} }, { sinceMsgId: 99 })) void _;
    })();
    expect(fetch).toHaveBeenCalledWith(99);
  });
});
