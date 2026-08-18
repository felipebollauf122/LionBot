import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import {
  chooseStrategy,
  routeGroup,
  createPublisher,
} from "../../src/services/mtproto/clone/publish-router.js";
import type { PublisherContext } from "../../src/services/mtproto/clone/publish-router.js";
import type { CompanionBot } from "../../src/services/mtproto/clone/bot-client.js";
import type { SourceReader } from "../../src/services/mtproto/clone/source-reader.js";
import type { SourceMessage } from "../../src/services/mtproto/clone/types.js";

describe("chooseStrategy", () => {
  it("auto vira batch quando a origem permite encaminhar", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("batch");
  });

  it("auto vira download quando a origem protege o conteúdo", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: true, copyButtons: false }),
    ).toBe("download");
  });

  it("botões inline forçam download mesmo com origem liberada", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: true }),
    ).toBe("download");
  });

  it("batch pedido explicitamente ainda cai pra download se a origem protege", () => {
    expect(
      chooseStrategy({ requested: "batch", sourceHasNoForwards: true, copyButtons: false }),
    ).toBe("download");
  });

  it("download pedido explicitamente é respeitado", () => {
    expect(
      chooseStrategy({ requested: "download", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("download");
  });

  it("copyReplies força download mesmo com origem liberada (defeito I5: forward não ancora reply)", () => {
    expect(
      chooseStrategy({
        requested: "auto",
        sourceHasNoForwards: false,
        copyButtons: false,
        copyReplies: true,
      }),
    ).toBe("download");
  });

  it("copyReplies omitido continua batch (default false, compatível com call site que ainda não passa o campo)", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("batch");
  });

  it("crossAccount força download mesmo quando a rota rápida seria escolhida", () => {
    // origem liberada, sem botões, sem reply — seria "batch" se fosse mesma conta.
    expect(
      chooseStrategy({
        requested: "auto",
        sourceHasNoForwards: false,
        copyButtons: false,
        crossAccount: true,
      }),
    ).toBe("download");
  });

  it("crossAccount omitido continua batch (default false = mesma conta)", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("batch");
  });

  it("linkReplaceConfigured força download — forward nunca vê texto/entities pra trocar", () => {
    expect(
      chooseStrategy({
        requested: "auto",
        sourceHasNoForwards: false,
        copyButtons: false,
        linkReplaceConfigured: true,
      }),
    ).toBe("download");
  });

  it("linkReplaceConfigured omitido continua batch (default false)", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("batch");
  });
});

describe("routeGroup", () => {
  const base = { strategy: "batch" as const, copyPolls: false, copyButtons: false };

  it("na rota batch, encaminha o grupo inteiro", () => {
    expect(
      routeGroup({ ...base, plans: [{ kind: "text" }, { kind: "media", mediaKind: "photo" }] }),
    ).toEqual({ mode: "forward" });
  });

  it("na rota batch, grupo com item não clonável ainda encaminha os clonáveis", () => {
    expect(
      routeGroup({
        ...base,
        plans: [{ kind: "text" }, { kind: "skip", reason: "media_invoice" }],
      }),
    ).toEqual({ mode: "forward", skipIndexes: [1] });
  });

  it("na rota batch, grupo todo não clonável é pulado sem chamar o Telegram", () => {
    expect(
      routeGroup({ ...base, plans: [{ kind: "skip", reason: "media_giveaway" }] }),
    ).toEqual({ mode: "skip_all" });
  });

  it("na rota download, álbum de fotos vai como álbum", () => {
    expect(
      routeGroup({
        ...base,
        strategy: "download",
        plans: [
          { kind: "media", mediaKind: "photo" },
          { kind: "media", mediaKind: "video" },
        ],
      }),
    ).toEqual({ mode: "album" });
  });

  it("na rota download, mensagem solta vai individual", () => {
    expect(
      routeGroup({ ...base, strategy: "download", plans: [{ kind: "text" }] }),
    ).toEqual({ mode: "single" });
  });

  it("na rota download, álbum com item não-álbum degrada para envios individuais", () => {
    expect(
      routeGroup({
        ...base,
        strategy: "download",
        plans: [
          { kind: "media", mediaKind: "photo" },
          { kind: "media", mediaKind: "document" },
        ],
      }),
    ).toEqual({ mode: "single" });
  });
});

// --- createPublisher: ramo "album" -----------------------------------------
//
// Fakes injetados via PublisherContext (ctx.reader/ctx.bot). Nunca constrói
// um SourceReader ou CompanionBot de verdade — por isso este arquivo não
// importa server/src/config.ts (nem nada que o importe).

/** Mensagem-fonte de foto: mediaClassName sai direto de media.className, sem precisar de instanceof. */
function photoRaw(id: number, message = ""): Api.Message {
  return {
    id,
    message,
    media: { className: "MessageMediaPhoto" },
    entities: undefined,
    replyMarkup: undefined,
  } as unknown as Api.Message;
}

/**
 * Mensagem-fonte de vídeo: precisa de instâncias reais de Api.MessageMediaDocument/
 * Api.Document/Api.DocumentAttributeVideo porque SourceReader.mediaPlanInput usa
 * `instanceof` pra extrair os atributos do documento (não basta className falso).
 */
function videoRaw(id: number, message = ""): Api.Message {
  const document = new Api.Document({
    id: 0,
    accessHash: 0,
    fileReference: Buffer.alloc(0),
    date: 0,
    mimeType: "video/mp4",
    size: 0,
    dcId: 1,
    attributes: [new Api.DocumentAttributeVideo({ duration: 1, w: 1, h: 1 })],
  } as never);
  const media = new Api.MessageMediaDocument({ document } as never);
  return { id, message, media, entities: undefined, replyMarkup: undefined } as unknown as Api.Message;
}

function sourceMessage(raw: Api.Message, groupedId = "g1", topicId: number | null = null): SourceMessage {
  return { id: raw.id, groupedId, replyToMsgId: null, topicId, raw };
}

/**
 * Mensagem-fonte de enquete: instâncias reais de Api.MessageMediaPoll/Api.Poll
 * (não só className falso) porque SourceReader.pollData usa `instanceof` e lê
 * poll.question/poll.answers de verdade.
 */
function pollRaw(id: number, question = "Gosta de gatos?", options = ["Sim", "Não"]): Api.Message {
  const poll = new Api.Poll({
    id: bigInt(1),
    question: new Api.TextWithEntities({ text: question, entities: [] }),
    answers: options.map(
      (text, i) =>
        new Api.PollAnswer({
          text: new Api.TextWithEntities({ text, entities: [] }),
          option: Buffer.from([i]),
        }),
    ),
  } as never);
  const media = new Api.MessageMediaPoll({ poll, results: {} } as never);
  return { id, message: "", media, entities: undefined, replyMarkup: undefined } as unknown as Api.Message;
}

interface FakeBot {
  publishAlbum: ReturnType<typeof vi.fn>;
  publishMedia: ReturnType<typeof vi.fn>;
  publishText: ReturnType<typeof vi.fn>;
  publishPoll: ReturnType<typeof vi.fn>;
}

function makeFakeBot(): FakeBot {
  return {
    publishAlbum: vi.fn(),
    publishMedia: vi.fn(),
    publishText: vi.fn(),
    publishPoll: vi.fn(),
  };
}

/** Reader falso: baixa qualquer coisa, exceto os ids marcados como grandes demais. */
function makeFakeReader(tooLargeIds: Set<number> = new Set()): SourceReader {
  return {
    downloadToPath: vi.fn(async (msg: Api.Message) => {
      if (tooLargeIds.has(msg.id)) return null;
      return { filePath: `/fake/tmp/msg_${msg.id}`, sizeBytes: 123 };
    }),
  } as unknown as SourceReader;
}

function makeCtx(
  reader: SourceReader,
  bot: FakeBot,
  topicMap: Map<number, number> | null = null,
  linkReplace: PublisherContext["linkReplace"] = null,
): PublisherContext {
  return {
    reader,
    bot: bot as unknown as CompanionBot,
    destChannelId: "1",
    destAccessHash: "0",
    strategy: "download",
    copyPolls: false,
    copyButtons: false,
    tmpDir: "/fake/tmp",
    topicMap,
    linkReplace,
  };
}

describe("createPublisher — rota album", () => {
  it("todos os itens ok: uma chamada a publishAlbum, outcomes copied em ordem", async () => {
    const bot = makeFakeBot();
    bot.publishAlbum.mockImplementation(async (items: unknown[]) =>
      items.map((_, i) => 9000 + i),
    );
    const reader = makeFakeReader();
    const publish = createPublisher(makeCtx(reader, bot));
    const group = [
      sourceMessage(photoRaw(1)),
      sourceMessage(photoRaw(2)),
      sourceMessage(photoRaw(3)),
    ];

    const outcomes = await publish(group, null);

    expect(bot.publishAlbum).toHaveBeenCalledTimes(1);
    expect(bot.publishMedia).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      { status: "copied", destMsgId: 9000 },
      { status: "copied", destMsgId: 9001 },
      { status: "copied", destMsgId: 9002 },
    ]);
  });

  it("um dos três grande demais: degrada pra envios individuais preservando ordem e mediaKind real", async () => {
    const bot = makeFakeBot();
    bot.publishMedia.mockImplementation(async (_path: string, kind: string) =>
      kind === "video" ? 8001 : 8000,
    );
    // msg 3 (a foto) é a grande demais; msg 1 (foto) e msg 2 (vídeo) baixam ok.
    const reader = makeFakeReader(new Set([3]));
    const publish = createPublisher(makeCtx(reader, bot));
    const group = [
      sourceMessage(photoRaw(1)),
      sourceMessage(videoRaw(2)),
      sourceMessage(photoRaw(3)),
    ];

    const outcomes = await publish(group, null);

    expect(bot.publishAlbum).not.toHaveBeenCalled();
    expect(bot.publishMedia).toHaveBeenCalledTimes(2);
    // mediaKind real repassado, não assumido como foto:
    expect(bot.publishMedia.mock.calls[0][1]).toBe("photo");
    expect(bot.publishMedia.mock.calls[1][1]).toBe("video");
    expect(outcomes).toEqual([
      { status: "copied", destMsgId: 8000 },
      { status: "copied", destMsgId: 8001 },
      { status: "skipped", reason: "file_too_large" },
    ]);
  });

  it("todos grandes demais: nenhuma chamada ao Telegram, todos skipped/file_too_large", async () => {
    const bot = makeFakeBot();
    const reader = makeFakeReader(new Set([1, 2]));
    const publish = createPublisher(makeCtx(reader, bot));
    const group = [sourceMessage(photoRaw(1)), sourceMessage(photoRaw(2))];

    const outcomes = await publish(group, null);

    expect(bot.publishAlbum).not.toHaveBeenCalled();
    expect(bot.publishMedia).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      { status: "skipped", reason: "file_too_large" },
      { status: "skipped", reason: "file_too_large" },
    ]);
  });

  it("publishAlbum devolve menos ids que itens: os que sobram viram failed, tamanho preservado", async () => {
    const bot = makeFakeBot();
    bot.publishAlbum.mockResolvedValue([7000]); // só 1 id pra 3 itens
    const reader = makeFakeReader();
    const publish = createPublisher(makeCtx(reader, bot));
    const group = [
      sourceMessage(photoRaw(1)),
      sourceMessage(photoRaw(2)),
      sourceMessage(photoRaw(3)),
    ];

    const outcomes = await publish(group, null);

    expect(outcomes).toHaveLength(3);
    expect(outcomes).toEqual([
      { status: "copied", destMsgId: 7000 },
      { status: "failed", reason: "album_id_count_mismatch" },
      { status: "failed", reason: "album_id_count_mismatch" },
    ]);
  });

  it("replyToDestId vai no álbum inteiro quando todos os itens ok", async () => {
    const bot = makeFakeBot();
    bot.publishAlbum.mockImplementation(async (items: unknown[]) =>
      items.map((_, i) => 6000 + i),
    );
    const reader = makeFakeReader();
    const publish = createPublisher(makeCtx(reader, bot));
    const group = [sourceMessage(photoRaw(1)), sourceMessage(photoRaw(2))];

    await publish(group, 555);

    expect(bot.publishAlbum).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ replyToMessageId: 555 }),
    );
  });

  it("replyToDestId vai só no primeiro envio individual quando degrada", async () => {
    const bot = makeFakeBot();
    bot.publishMedia.mockResolvedValue(6100);
    // msg 2 grande demais -> sobra só 1 item ok, degrada mesmo assim.
    const reader = makeFakeReader(new Set([2]));
    const publish = createPublisher(makeCtx(reader, bot));
    const group = [sourceMessage(photoRaw(1)), sourceMessage(photoRaw(2))];

    await publish(group, 777);

    expect(bot.publishMedia).toHaveBeenCalledTimes(1);
    expect(bot.publishMedia.mock.calls[0][3]).toEqual(
      expect.objectContaining({ replyToMessageId: 777 }),
    );
  });
});

// --- createPublisher: rota download, enquete (defeito I7) -------------------
//
// Antes do fix, plan.kind === "poll" na rota download sempre virava
// { status: "skipped", reason: "poll_sem_suporte_no_bot" }, mesmo com
// copyPolls ligado — o toggle "recria enquete" da UI era um no-op.

describe("createPublisher — rota download, enquete", () => {
  function makePollCtx(reader: SourceReader, bot: FakeBot): PublisherContext {
    return { ...makeCtx(reader, bot), copyPolls: true };
  }

  it("copyPolls ligado: recria a enquete via publishPoll em vez de pular", async () => {
    const bot = makeFakeBot();
    bot.publishPoll.mockResolvedValue(4242);
    const reader = makeFakeReader();
    const publish = createPublisher(makePollCtx(reader, bot));
    const group = [sourceMessage(pollRaw(1, "Gosta de gatos?", ["Sim", "Não"]))];

    const outcomes = await publish(group, null);

    expect(bot.publishPoll).toHaveBeenCalledTimes(1);
    expect(bot.publishPoll.mock.calls[0][0]).toEqual({
      question: "Gosta de gatos?",
      options: ["Sim", "Não"],
      isAnonymous: true,
      allowsMultipleAnswers: false,
    });
    // Enquete não tem arquivo: downloadToPath não deve ser chamado pra ela.
    expect(reader.downloadToPath).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ status: "copied", destMsgId: 4242 }]);
  });

  it("replyToDestId vai pra enquete quando ela é a primeira mensagem do grupo", async () => {
    const bot = makeFakeBot();
    bot.publishPoll.mockResolvedValue(5555);
    const reader = makeFakeReader();
    const publish = createPublisher(makePollCtx(reader, bot));
    const group = [sourceMessage(pollRaw(1))];

    await publish(group, 321);

    expect(bot.publishPoll).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Gosta de gatos?" }),
      expect.objectContaining({ replyToMessageId: 321 }),
    );
  });
});

// --- createPublisher: tópicos de fórum ---------------------------------

/** Mensagem-fonte de texto simples: mediaClassName null, hasText true -> plan {kind:"text"}. */
function textRaw(id: number, message = "oi"): Api.Message {
  return { id, message, media: null, entities: undefined, replyMarkup: undefined } as unknown as Api.Message;
}

/** Monta um Api.Updates real o bastante pra extractNewMessageIds reconhecer os ids criados. */
function fakeForwardUpdates(ids: number[]): Api.TypeUpdates {
  return new Api.Updates({
    updates: ids.map(
      (id) =>
        new Api.UpdateNewChannelMessage({
          message: new Api.Message({ id, message: "" } as never),
          pts: 1,
          ptsCount: 1,
        } as never),
    ),
    users: [],
    chats: [],
    date: 0,
    seq: 0,
  } as never);
}

function makeFakeForwardReader(forwardBatch: ReturnType<typeof vi.fn>): SourceReader {
  return { forwardBatch } as unknown as SourceReader;
}

describe("createPublisher — tópicos de fórum", () => {
  it("rota forward: tópico mapeado vira topMsgId (4º argumento de forwardBatch)", async () => {
    const forwardBatch = vi.fn(async () => fakeForwardUpdates([9000]));
    const reader = makeFakeForwardReader(forwardBatch);
    const bot = makeFakeBot();
    const ctx = { ...makeCtx(reader, bot, new Map([[15, 555]])), strategy: "batch" as const };
    const publish = createPublisher(ctx);

    const outcomes = await publish([sourceMessage(textRaw(1), "g1", 15)], null);

    expect(forwardBatch).toHaveBeenCalledWith("1", "0", [1], 555);
    expect(outcomes).toEqual([{ status: "copied", destMsgId: 9000 }]);
  });

  it("rota forward: tópico sem mapeamento (falhou ao criar) cai em General (1)", async () => {
    const forwardBatch = vi.fn(async () => fakeForwardUpdates([9001]));
    const reader = makeFakeForwardReader(forwardBatch);
    const bot = makeFakeBot();
    const ctx = { ...makeCtx(reader, bot, new Map()), strategy: "batch" as const };
    const publish = createPublisher(ctx);

    await publish([sourceMessage(textRaw(1), "g1", 15)], null);

    expect(forwardBatch).toHaveBeenCalledWith("1", "0", [1], 1);
  });

  it("rota forward: job sem fórum (topicMap null) nunca passa topMsgId, mesmo com msg.topicId setado", async () => {
    const forwardBatch = vi.fn(async () => fakeForwardUpdates([9002]));
    const reader = makeFakeForwardReader(forwardBatch);
    const bot = makeFakeBot();
    const ctx = { ...makeCtx(reader, bot, null), strategy: "batch" as const };
    const publish = createPublisher(ctx);

    await publish([sourceMessage(textRaw(1), "g1", 15)], null);

    expect(forwardBatch).toHaveBeenCalledWith("1", "0", [1], undefined);
  });

  it("rota álbum: messageThreadId repassado pro publishAlbum quando o tópico está mapeado", async () => {
    const bot = makeFakeBot();
    bot.publishAlbum.mockResolvedValue([1000, 1001]);
    const reader = makeFakeReader();
    const ctx = makeCtx(reader, bot, new Map([[20, 700]]));
    const publish = createPublisher(ctx);
    const group = [
      sourceMessage(photoRaw(1), "g1", 20),
      sourceMessage(photoRaw(2), "g1", 20),
    ];

    await publish(group, null);

    expect(bot.publishAlbum).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ messageThreadId: 700 }),
    );
  });

  it("rota single (texto): messageThreadId repassado pro publishText", async () => {
    const bot = makeFakeBot();
    bot.publishText.mockResolvedValue(2000);
    const reader = makeFakeReader();
    const ctx = makeCtx(reader, bot, new Map([[21, 800]]));
    const publish = createPublisher(ctx);

    await publish([sourceMessage(textRaw(1), "g1", 21)], null);

    expect(bot.publishText).toHaveBeenCalledWith(
      "oi",
      expect.objectContaining({ messageThreadId: 800 }),
    );
  });

  it("rota enquete: messageThreadId repassado pro publishPoll (opts hand-built, não reusa o objeto opts inteiro)", async () => {
    const bot = makeFakeBot();
    bot.publishPoll.mockResolvedValue(3000);
    const reader = makeFakeReader();
    const ctx = { ...makeCtx(reader, bot, new Map([[22, 900]])), copyPolls: true };
    const publish = createPublisher(ctx);

    await publish([sourceMessage(pollRaw(1), "g1", 22)], null);

    expect(bot.publishPoll).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Gosta de gatos?" }),
      expect.objectContaining({ messageThreadId: 900 }),
    );
  });

  it("mensagem sem tópico (topicId null) num job com fórum: messageThreadId fica undefined (General)", async () => {
    const bot = makeFakeBot();
    bot.publishText.mockResolvedValue(2100);
    const reader = makeFakeReader();
    const ctx = makeCtx(reader, bot, new Map([[21, 800]]));
    const publish = createPublisher(ctx);

    await publish([sourceMessage(textRaw(1), "g1", null)], null);

    expect(bot.publishText).toHaveBeenCalledWith(
      "oi",
      expect.objectContaining({ messageThreadId: undefined }),
    );
  });
});

// --- createPublisher: troca de link por categoria ---------------------

function mentionRaw(id: number, text: string, mentionText: string): Api.Message {
  const offset = text.indexOf(mentionText);
  return {
    id,
    message: text,
    media: null,
    entities: [new Api.MessageEntityMention({ offset, length: mentionText.length })],
    replyMarkup: undefined,
  } as unknown as Api.Message;
}

function photoRawWithText(id: number, text: string, mentionText: string): Api.Message {
  const offset = text.indexOf(mentionText);
  return {
    id,
    message: text,
    media: { className: "MessageMediaPhoto" },
    entities: [new Api.MessageEntityMention({ offset, length: mentionText.length })],
    replyMarkup: undefined,
  } as unknown as Api.Message;
}

describe("createPublisher — troca de link por categoria", () => {
  it("rota single (texto): mention classificada troca pelo valor configurado", async () => {
    const bot = makeFakeBot();
    bot.publishText.mockResolvedValue(5000);
    const reader = makeFakeReader();
    const classify = vi.fn(async () => "bot" as const);
    const ctx = makeCtx(reader, bot, null, { classify, values: { botUsername: "novobot" } });
    const publish = createPublisher(ctx);

    const raw = mentionRaw(1, "fale com @velhobot agora", "@velhobot");
    await publish([sourceMessage(raw)], null);

    expect(bot.publishText).toHaveBeenCalledWith("fale com @novobot agora", expect.anything());
    expect(classify).toHaveBeenCalledWith("@velhobot");
  });

  it("ctx.linkReplace null: comportamento idêntico ao de antes da feature (regressão)", async () => {
    const bot = makeFakeBot();
    bot.publishText.mockResolvedValue(5001);
    const reader = makeFakeReader();
    const ctx = makeCtx(reader, bot, null, null);
    const publish = createPublisher(ctx);

    const raw = mentionRaw(1, "fale com @velhobot agora", "@velhobot");
    await publish([sourceMessage(raw)], null);

    expect(bot.publishText).toHaveBeenCalledWith("fale com @velhobot agora", expect.anything());
  });

  it("rota enquete: classify nunca é chamado (enquete não usa texto/entities)", async () => {
    const bot = makeFakeBot();
    bot.publishPoll.mockResolvedValue(5002);
    const reader = makeFakeReader();
    const classify = vi.fn(async () => "bot" as const);
    const ctx = {
      ...makeCtx(reader, bot, null, { classify, values: { botUsername: "novobot" } }),
      copyPolls: true,
    };
    const publish = createPublisher(ctx);

    await publish([sourceMessage(pollRaw(1))], null);

    expect(classify).not.toHaveBeenCalled();
  });

  it("rota álbum de verdade: reescreve a legenda de cada item", async () => {
    const bot = makeFakeBot();
    bot.publishAlbum.mockImplementation(async (items: unknown[]) => items.map((_, i) => 6000 + i));
    const reader = makeFakeReader();
    const classify = vi.fn(async () => "channel" as const);
    const ctx = makeCtx(reader, bot, null, { classify, values: { channelLink: "t.me/canalnovo" } });
    const publish = createPublisher(ctx);

    const text = "veja @velhocanal";
    const group = [
      sourceMessage(photoRawWithText(1, text, "@velhocanal")),
      sourceMessage(photoRawWithText(2, text, "@velhocanal")),
    ];

    await publish(group, null);

    expect(bot.publishAlbum).toHaveBeenCalledWith(
      [
        expect.objectContaining({ caption: "veja t.me/canalnovo" }),
        expect.objectContaining({ caption: "veja t.me/canalnovo" }),
      ],
      expect.anything(),
    );
  });

  it("rota álbum degradada (item grande demais): fallback item-a-item também reescreve a legenda", async () => {
    const bot = makeFakeBot();
    bot.publishMedia.mockResolvedValue(6100);
    const reader = makeFakeReader(new Set([2])); // msg 2 grande demais -> degrada
    const classify = vi.fn(async () => "channel" as const);
    const ctx = makeCtx(reader, bot, null, { classify, values: { channelLink: "t.me/canalnovo" } });
    const publish = createPublisher(ctx);

    const text = "veja @velhocanal";
    const group = [
      sourceMessage(photoRawWithText(1, text, "@velhocanal")),
      sourceMessage(photoRawWithText(2, text, "@velhocanal")),
    ];

    await publish(group, null);

    expect(bot.publishMedia).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "veja t.me/canalnovo",
      expect.anything(),
    );
  });
});
