import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
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

function sourceMessage(raw: Api.Message, groupedId = "g1"): SourceMessage {
  return { id: raw.id, groupedId, replyToMsgId: null, raw };
}

interface FakeBot {
  publishAlbum: ReturnType<typeof vi.fn>;
  publishMedia: ReturnType<typeof vi.fn>;
  publishText: ReturnType<typeof vi.fn>;
}

function makeFakeBot(): FakeBot {
  return {
    publishAlbum: vi.fn(),
    publishMedia: vi.fn(),
    publishText: vi.fn(),
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

function makeCtx(reader: SourceReader, bot: FakeBot): PublisherContext {
  return {
    reader,
    bot: bot as unknown as CompanionBot,
    destChannelId: "1",
    destAccessHash: "0",
    strategy: "download",
    copyPolls: false,
    copyButtons: false,
    tmpDir: "/fake/tmp",
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
