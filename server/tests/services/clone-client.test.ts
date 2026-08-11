import { describe, it, expect } from "vitest";
import { Api } from "telegram";
import { extractNewTopicId } from "../../src/services/mtproto/client.js";

/**
 * extractNewTopicId é o ponto crítico da criação de tópicos (defeito
 * equivalente ao extractNewMessageIds do publish-router): errar aqui faz
 * TODO tópico falhar silenciosamente (createForumTopic joga, topic-sync.ts
 * marca 'failed', as mensagens daquele tópico caem em General) sem nenhum
 * crash visível — vale isolar com teste próprio, mesmo client.ts não tendo
 * cobertura direta pra mais nada.
 */
describe("extractNewTopicId", () => {
  it("acha o id da MessageService dentro de Updates/UpdateNewChannelMessage", () => {
    const service = new Api.MessageService({
      id: 42,
      action: new Api.MessageActionTopicCreate({ title: "x", iconColor: 0 } as never),
    } as never);
    const updates = new Api.Updates({
      updates: [new Api.UpdateNewChannelMessage({ message: service, pts: 1, ptsCount: 1 } as never)],
      users: [],
      chats: [],
      date: 0,
      seq: 0,
    } as never);
    expect(extractNewTopicId(updates)).toBe(42);
  });

  it("acha o id dentro de UpdatesCombined/UpdateNewMessage", () => {
    const service = new Api.MessageService({
      id: 43,
      action: new Api.MessageActionTopicCreate({ title: "x", iconColor: 0 } as never),
    } as never);
    const updates = new Api.UpdatesCombined({
      updates: [new Api.UpdateNewMessage({ message: service, pts: 1, ptsCount: 1 } as never)],
      users: [],
      chats: [],
      date: 0,
      seq: 0,
      seqStart: 0,
    } as never);
    expect(extractNewTopicId(updates)).toBe(43);
  });

  it("só Api.Message (sem serviço) presente: devolve null", () => {
    const msg = new Api.Message({ id: 44, message: "oi" } as never);
    const updates = new Api.Updates({
      updates: [new Api.UpdateNewChannelMessage({ message: msg, pts: 1, ptsCount: 1 } as never)],
      users: [],
      chats: [],
      date: 0,
      seq: 0,
    } as never);
    expect(extractNewTopicId(updates)).toBeNull();
  });

  it("Updates sem nenhuma update relevante: devolve null", () => {
    const updates = new Api.Updates({
      updates: [],
      users: [],
      chats: [],
      date: 0,
      seq: 0,
    } as never);
    expect(extractNewTopicId(updates)).toBeNull();
  });

  it("tipo de Updates desconhecido (nem Updates nem UpdatesCombined): devolve null", () => {
    const updates = new Api.UpdatesTooLong();
    expect(extractNewTopicId(updates)).toBeNull();
  });
});
