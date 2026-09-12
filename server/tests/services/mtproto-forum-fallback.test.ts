import { describe, it, expect, vi } from "vitest";
import {
  pickOpenTopic,
  sendWithForumFallback,
} from "../../src/services/mtproto/forum-fallback.js";

const topicClosed = () => new Error("400: TOPIC_CLOSED (caused by messages.SendMessage)");

describe("pickOpenTopic", () => {
  it("prefere o General (id 1) quando está aberto", () => {
    expect(
      pickOpenTopic([
        { id: 7, title: "Ofertas" },
        { id: 1, title: "General" },
      ]),
    ).toBe(1);
  });

  it("com o General fechado, pega o primeiro tópico aberto e visível", () => {
    expect(
      pickOpenTopic([
        { id: 1, title: "General", closed: true },
        { id: 5, title: "Regras", closed: true },
        { id: 9, title: "Oculto", hidden: true },
        { id: 12, title: "Divulgação" },
        { id: 20, title: "Outro" },
      ]),
    ).toBe(12);
  });

  it("sem tópico aberto devolve null", () => {
    expect(pickOpenTopic([{ id: 1, closed: true }, { id: 3, closed: true }])).toBeNull();
    expect(pickOpenTopic([])).toBeNull();
  });
});

describe("sendWithForumFallback", () => {
  it("sem tópico conhecido manda direto (General) e não lista tópicos", async () => {
    const send = vi.fn(async () => {});
    const listTopics = vi.fn(async () => []);
    await sendWithForumFallback({ knownTopicId: null, send, listTopics, rememberTopic: async () => {} });
    expect(send).toHaveBeenCalledWith(undefined);
    expect(listTopics).not.toHaveBeenCalled();
  });

  it("com tópico conhecido manda nele de primeira", async () => {
    const send = vi.fn(async () => {});
    await sendWithForumFallback({
      knownTopicId: 12,
      send,
      listTopics: async () => [],
      rememberTopic: async () => {},
    });
    expect(send).toHaveBeenCalledWith(12);
  });

  it("TOPIC_CLOSED: lista tópicos, reenvia num aberto e guarda o escolhido", async () => {
    const calls: Array<number | undefined> = [];
    const send = vi.fn(async (topMsgId?: number) => {
      calls.push(topMsgId);
      if (topMsgId === undefined) throw topicClosed();
    });
    const rememberTopic = vi.fn(async () => {});
    await sendWithForumFallback({
      knownTopicId: null,
      send,
      listTopics: async () => [
        { id: 1, closed: true },
        { id: 12, title: "Divulgação" },
      ],
      rememberTopic,
    });
    expect(calls).toEqual([undefined, 12]);
    expect(rememberTopic).toHaveBeenCalledWith(12);
  });

  it("tópico guardado que fechou depois: cai no fallback igual", async () => {
    const calls: Array<number | undefined> = [];
    const send = vi.fn(async (topMsgId?: number) => {
      calls.push(topMsgId);
      if (topMsgId === 12) throw topicClosed();
    });
    const rememberTopic = vi.fn(async () => {});
    await sendWithForumFallback({
      knownTopicId: 12,
      send,
      listTopics: async () => [
        { id: 12, closed: true },
        { id: 30, title: "Novo" },
      ],
      rememberTopic,
    });
    expect(calls).toEqual([12, 30]);
    expect(rememberTopic).toHaveBeenCalledWith(30);
  });

  it("sem nenhum tópico aberto, relança o TOPIC_CLOSED original (vira alvo pulado)", async () => {
    const send = vi.fn(async () => {
      throw topicClosed();
    });
    await expect(
      sendWithForumFallback({
        knownTopicId: null,
        send,
        listTopics: async () => [{ id: 1, closed: true }],
        rememberTopic: async () => {},
      }),
    ).rejects.toThrow(/TOPIC_CLOSED/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("qualquer outro erro passa reto, sem listar tópicos", async () => {
    const listTopics = vi.fn(async () => []);
    await expect(
      sendWithForumFallback({
        knownTopicId: null,
        send: async () => {
          throw new Error("403: CHAT_WRITE_FORBIDDEN (caused by messages.SendMessage)");
        },
        listTopics,
        rememberTopic: async () => {},
      }),
    ).rejects.toThrow(/CHAT_WRITE_FORBIDDEN/);
    expect(listTopics).not.toHaveBeenCalled();
  });
});
