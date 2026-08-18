import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { FloodWaitError } from "telegram/errors/index.js";
import {
  extractNewTopicId,
  classifyResolvedPeer,
  classifyChatInvite,
  MtprotoClient,
} from "../../src/services/mtproto/client.js";

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

function resolvedPeer(
  peer: Api.TypePeer,
  users: Api.TypeUser[] = [],
  chats: Api.TypeChat[] = [],
): Api.contacts.TypeResolvedPeer {
  return new Api.contacts.ResolvedPeer({ peer, chats, users } as never);
}

describe("classifyResolvedPeer", () => {
  it("PeerUser com bot:true vira bot", () => {
    const user = new Api.User({ id: bigInt(1), bot: true } as never);
    const result = resolvedPeer(new Api.PeerUser({ userId: bigInt(1) } as never), [user]);
    expect(classifyResolvedPeer(result)).toBe("bot");
  });

  it("PeerUser com bot:false vira user", () => {
    const user = new Api.User({ id: bigInt(1), bot: false } as never);
    const result = resolvedPeer(new Api.PeerUser({ userId: bigInt(1) } as never), [user]);
    expect(classifyResolvedPeer(result)).toBe("user");
  });

  it("PeerChannel broadcast:true vira channel", () => {
    const chan = new Api.Channel({ id: bigInt(2), broadcast: true } as never);
    const result = resolvedPeer(new Api.PeerChannel({ channelId: bigInt(2) } as never), [], [chan]);
    expect(classifyResolvedPeer(result)).toBe("channel");
  });

  it("PeerChannel megagroup (broadcast false) vira group", () => {
    const chan = new Api.Channel({ id: bigInt(3), broadcast: false, megagroup: true } as never);
    const result = resolvedPeer(new Api.PeerChannel({ channelId: bigInt(3) } as never), [], [chan]);
    expect(classifyResolvedPeer(result)).toBe("group");
  });

  it("PeerChat (grupo legado) vira group", () => {
    const chat = new Api.Chat({ id: bigInt(4) } as never);
    const result = resolvedPeer(new Api.PeerChat({ chatId: bigInt(4) } as never), [], [chat]);
    expect(classifyResolvedPeer(result)).toBe("group");
  });

  it("ChannelForbidden ainda é classificável (broadcast/megagroup preservados)", () => {
    const chan = new Api.ChannelForbidden({ id: bigInt(5), broadcast: true, title: "x" } as never);
    const result = resolvedPeer(new Api.PeerChannel({ channelId: bigInt(5) } as never), [], [chan]);
    expect(classifyResolvedPeer(result)).toBe("channel");
  });

  it("peer sem correspondência em users/chats vira unknown", () => {
    const result = resolvedPeer(new Api.PeerUser({ userId: bigInt(999) } as never), []);
    expect(classifyResolvedPeer(result)).toBe("unknown");
  });
});

describe("classifyChatInvite", () => {
  it("ChatInviteAlready classifica via .chat", () => {
    const chan = new Api.Channel({ id: bigInt(1), broadcast: true } as never);
    const invite = new Api.ChatInviteAlready({ chat: chan } as never);
    expect(classifyChatInvite(invite)).toBe("channel");
  });

  it("ChatInvitePeek classifica via .chat", () => {
    const chat = new Api.Chat({ id: bigInt(2) } as never);
    const invite = new Api.ChatInvitePeek({ chat, expires: 0 } as never);
    expect(classifyChatInvite(invite)).toBe("group");
  });

  it("ChatInvite com broadcast:true vira channel", () => {
    const invite = new Api.ChatInvite({ broadcast: true, title: "x" } as never);
    expect(classifyChatInvite(invite)).toBe("channel");
  });

  it("ChatInvite com megagroup:true vira group", () => {
    const invite = new Api.ChatInvite({ megagroup: true, title: "x" } as never);
    expect(classifyChatInvite(invite)).toBe("group");
  });

  it("ChatInvite sem broadcast nem megagroup (chat legado) vira group", () => {
    const invite = new Api.ChatInvite({ title: "x" } as never);
    expect(classifyChatInvite(invite)).toBe("group");
  });
});

/**
 * client (o TelegramClient real) é privado em MtprotoClient e sem seam de
 * injeção — mesmo padrão de clone-promote.test.ts: substitui via cast
 * `as any` depois de construir a instância, sem mudar client.ts.
 */
interface FakeClient {
  connected: boolean;
  connect: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
}

function makeClientWithFakeInvoke(invoke: ReturnType<typeof vi.fn>): MtprotoClient {
  const client = new MtprotoClient(1, "fake-hash", "");
  const fake: FakeClient = { connected: true, connect: vi.fn(async () => {}), invoke };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).client = fake;
  return client;
}

describe("MtprotoClient.classifyLink", () => {
  it("cacheia resultado — 2ª chamada com mesmo identificador não invoca de novo", async () => {
    const chan = new Api.Channel({ id: bigInt(1), broadcast: true } as never);
    const invoke = vi.fn(async () =>
      new Api.contacts.ResolvedPeer({
        peer: new Api.PeerChannel({ channelId: bigInt(1) } as never),
        chats: [chan],
        users: [],
      } as never),
    );
    const client = makeClientWithFakeInvoke(invoke);

    const first = await client.classifyLink({ kind: "username", value: "meucanal" });
    const second = await client.classifyLink({ kind: "username", value: "meucanal" });

    expect(first).toBe("channel");
    expect(second).toBe("channel");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("cache é case-insensitive pro username", async () => {
    const user = new Api.User({ id: bigInt(1), bot: true } as never);
    const invoke = vi.fn(async () =>
      new Api.contacts.ResolvedPeer({
        peer: new Api.PeerUser({ userId: bigInt(1) } as never),
        chats: [],
        users: [user],
      } as never),
    );
    const client = makeClientWithFakeInvoke(invoke);

    await client.classifyLink({ kind: "username", value: "MeuBot" });
    await client.classifyLink({ kind: "username", value: "meubot" });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("erro não-flood vira 'unknown' e fica cacheado (não invoca de novo)", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("USERNAME_NOT_OCCUPIED (400)");
    });
    const client = makeClientWithFakeInvoke(invoke);

    const first = await client.classifyLink({ kind: "username", value: "naoexiste" });
    const second = await client.classifyLink({ kind: "username", value: "naoexiste" });

    expect(first).toBe("unknown");
    expect(second).toBe("unknown");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("flood propaga e NUNCA fica cacheado", async () => {
    const invoke = vi.fn(async () => {
      throw new FloodWaitError({ request: undefined as never, capture: 30 } as never);
    });
    const client = makeClientWithFakeInvoke(invoke);

    await expect(
      client.classifyLink({ kind: "username", value: "algum" }),
    ).rejects.toBeInstanceOf(FloodWaitError);
    // não cacheado: uma 2ª tentativa invoca de novo.
    await expect(
      client.classifyLink({ kind: "username", value: "algum" }),
    ).rejects.toBeInstanceOf(FloodWaitError);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("identificador de convite usa CheckChatInvite", async () => {
    const chat = new Api.Chat({ id: bigInt(9) } as never);
    const invoke = vi.fn(async (req: unknown) => {
      expect(req).toBeInstanceOf(Api.messages.CheckChatInvite);
      return new Api.ChatInviteAlready({ chat } as never);
    });
    const client = makeClientWithFakeInvoke(invoke);

    const kind = await client.classifyLink({ kind: "invite", hash: "AbCdEf" });
    expect(kind).toBe("group");
  });
});
