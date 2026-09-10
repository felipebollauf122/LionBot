import { describe, it, expect, vi } from "vitest";
import {
  createDraftPublisher,
  type DraftPublisherDeps,
  type StagedRow,
} from "../../src/services/mtproto/clone/draft-publisher.js";
import type { SourceMessage } from "../../src/services/mtproto/clone/types.js";

/** Mensagem de origem com um `raw` mínimo do que o publisher lê. */
function m(
  id: number,
  raw: Record<string, unknown> = {},
  over: Partial<SourceMessage> = {},
): SourceMessage {
  return {
    id,
    groupedId: null,
    replyToMsgId: null,
    topicId: null,
    raw: { id, message: "", entities: undefined, media: null, ...raw },
    ...over,
  };
}

function deps(over: Partial<DraftPublisherDeps> = {}): DraftPublisherDeps & {
  saved: StagedRow[];
} {
  const saved: StagedRow[] = [];
  const base: DraftPublisherDeps = {
    rehost: vi.fn(async (_raw, hint) => `https://cdn.test/${hint}`),
    upsert: vi.fn(async (rows: StagedRow[]) => {
      saved.push(...rows);
    }),
    // Substitui SourceReader.mediaPlanInput sem instanceof: lê o mesmo shape
    // que os fakes de `m()` produzem.
    planInput: (raw, copyPolls) => {
      const media = (raw as unknown as { media: { className: string } | null }).media;
      const msg = (raw as unknown as { message?: string }).message ?? "";
      return {
        mediaClassName: media ? media.className : null,
        documentAttributeClassNames: [],
        hasText: msg.trim() !== "",
        copyPolls,
      };
    },
    extractInlineLinks: vi.fn(() => undefined),
    pollData: vi.fn(() => null),
    originalFileName: vi.fn(() => null),
    copyPolls: false,
    copyButtons: false,
    rewrite: null,
  };
  return { ...base, ...over, saved };
}

describe("createDraftPublisher", () => {
  it("mensagem de texto vira uma linha e devolve o source id como destMsgId", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    const out = await publish([m(42, { message: "olá" })], null);

    expect(out).toEqual([{ status: "copied", destMsgId: 42 }]);
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({
      sourceMsgId: 42,
      kind: "text",
      contentText: "olá",
      media: [],
      position: 0,
      replyToSourceMsgId: null,
    });
  });

  it("mensagem vazia sem mídia é pulada, sem gravar linha", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    const out = await publish([m(1, { message: "" })], null);

    expect(out).toEqual([{ status: "skipped", reason: "empty_message" }]);
    expect(d.saved).toHaveLength(0);
  });

  it("foto rehospeda e grava a URL em media", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    const out = await publish(
      [m(7, { message: "legenda", media: { className: "MessageMediaPhoto" } })],
      null,
    );

    expect(out).toEqual([{ status: "copied", destMsgId: 7 }]);
    expect(d.saved[0]).toMatchObject({
      kind: "photo",
      contentText: "legenda",
      media: [{ url: "https://cdn.test/msg_7", type: "photo" }],
    });
  });

  it("mídia grande demais (rehost devolve null) vira skipped file_too_large", async () => {
    const d = deps({ rehost: vi.fn(async () => null) });
    const publish = createDraftPublisher(d);

    const out = await publish(
      [m(8, { media: { className: "MessageMediaPhoto" } })],
      null,
    );

    expect(out).toEqual([{ status: "skipped", reason: "file_too_large" }]);
    expect(d.saved).toHaveLength(0);
  });

  it("álbum vira UMA linha com N mídias, mas devolve um outcome por mensagem", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);
    const grupo = [
      m(10, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
      m(11, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
      m(12, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "copied", destMsgId: 10 },
      { status: "copied", destMsgId: 11 },
      { status: "copied", destMsgId: 12 },
    ]);
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({ kind: "album", sourceMsgId: 10, contentText: "capa" });
    expect(d.saved[0].media).toHaveLength(3);
  });

  it("álbum com item grande demais no meio: só ele cai, e a linha fica ancorada no primeiro sobrevivente", async () => {
    const d = deps({
      rehost: vi.fn(async (_raw, hint) => (hint === "msg_11" ? null : `https://cdn.test/${hint}`)),
    });
    const publish = createDraftPublisher(d);
    const grupo = [
      m(10, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
      m(11, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
      m(12, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g1" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "copied", destMsgId: 10 },
      { status: "skipped", reason: "file_too_large" },
      { status: "copied", destMsgId: 12 },
    ]);
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0].media).toHaveLength(2);
    expect(d.saved[0].sourceMsgId).toBe(10);
  });

  it("álbum cujo primeiro item cai: sourceMsgId migra pro sobrevivente, mas a legenda continua vindo de raws[0]", async () => {
    const d = deps({
      rehost: vi.fn(async (_raw, hint) => (hint === "msg_20" ? null : `https://cdn.test/${hint}`)),
    });
    const publish = createDraftPublisher(d);
    const grupo = [
      m(20, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g2" }),
      m(21, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g2" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "skipped", reason: "file_too_large" },
      { status: "copied", destMsgId: 21 },
    ]);
    expect(d.saved[0].sourceMsgId).toBe(21);
    expect(d.saved[0].contentText).toBe("capa");
  });

  it("álbum com item de mídia não suportada: esse índice vira skipped com o motivo do plano, não copied", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);
    const grupo = [
      m(30, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g3" }),
      m(31, { media: { className: "MessageMediaGame" } }, { groupedId: "g3" }),
      m(32, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g3" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "copied", destMsgId: 30 },
      { status: "skipped", reason: "media_game" },
      { status: "copied", destMsgId: 32 },
    ]);
    expect(d.saved[0].media).toHaveLength(2);
  });

  it("duas fotos e um item não suportado no meio: kind fica album e media leva as duas fotos (defeito A)", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);
    const grupo = [
      m(80, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g5" }),
      m(81, { media: { className: "MessageMediaPhoto" } }, { groupedId: "g5" }),
      m(82, { media: { className: "MessageMediaGame" } }, { groupedId: "g5" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "copied", destMsgId: 80 },
      { status: "copied", destMsgId: 81 },
      { status: "skipped", reason: "media_game" },
    ]);
    expect(d.saved[0].kind).toBe("album");
    expect(d.saved[0].media).toHaveLength(2);
  });

  it("item 0 cai (foto grande demais), item 1 é vídeo: kind vira video, não photo (defeito B)", async () => {
    const d = deps({
      rehost: vi.fn(async (_raw, hint) => (hint === "msg_70" ? null : `https://cdn.test/${hint}`)),
      planInput: (raw) => {
        const id = (raw as unknown as { id: number }).id;
        return {
          mediaClassName: id === 70 ? "MessageMediaPhoto" : "MessageMediaDocument",
          documentAttributeClassNames: id === 70 ? [] : ["DocumentAttributeVideo"],
          hasText: false,
          copyPolls: false,
        };
      },
    });
    const publish = createDraftPublisher(d);
    const grupo = [
      m(70, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g4" }),
      m(71, { media: { className: "MessageMediaDocument" } }, { groupedId: "g4" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "skipped", reason: "file_too_large" },
      { status: "copied", destMsgId: 71 },
    ]);
    expect(d.saved[0].kind).toBe("video");
    expect(d.saved[0].media).toEqual([{ url: "https://cdn.test/msg_71", type: "video" }]);
  });

  it("dois sobreviventes não albumáveis (foto + documento): media fica só com o âncora, o outro vira skipped grupo_nao_albumavel", async () => {
    const d = deps({
      planInput: (raw) => {
        const id = (raw as unknown as { id: number }).id;
        return {
          mediaClassName: id === 90 ? "MessageMediaPhoto" : "MessageMediaDocument",
          documentAttributeClassNames: [],
          hasText: false,
          copyPolls: false,
        };
      },
    });
    const publish = createDraftPublisher(d);
    const grupo = [
      m(90, { message: "capa", media: { className: "MessageMediaPhoto" } }, { groupedId: "g6" }),
      m(91, { media: { className: "MessageMediaDocument" } }, { groupedId: "g6" }),
    ];

    const out = await publish(grupo, null);

    expect(out).toEqual([
      { status: "copied", destMsgId: 90 },
      { status: "skipped", reason: "grupo_nao_albumavel" },
    ]);
    expect(d.saved[0].media).toHaveLength(1);
    expect(d.saved[0].kind).toBe("photo");
  });

  it("enquete sem dados (pollData devolve null) vira skipped poll_sem_dados, sem gravar linha", async () => {
    const d = deps({ pollData: vi.fn(() => null), copyPolls: true });
    const publish = createDraftPublisher(d);

    const out = await publish([m(60, { media: { className: "MessageMediaPoll" } })], null);

    expect(out).toEqual([{ status: "skipped", reason: "poll_sem_dados" }]);
    expect(d.saved).toHaveLength(0);
  });

  it("replyToDestId chega na linha como replyToSourceMsgId", async () => {
    const d = deps();
    const publish = createDraftPublisher(d);

    await publish([m(20, { message: "resposta" })], 15);

    expect(d.saved[0].replyToSourceMsgId).toBe(15);
  });

  it("enquete só vira linha com copyPolls ligado", async () => {
    const poll = {
      question: "gostou?",
      options: ["sim", "não"],
      isAnonymous: true,
      allowsMultipleAnswers: false,
    };
    const desligado = deps({ pollData: vi.fn(() => poll) });
    const publishOff = createDraftPublisher(desligado);
    expect(await publishOff([m(30, { media: { className: "MessageMediaPoll" } })], null)).toEqual([
      { status: "skipped", reason: "poll_disabled" },
    ]);
    expect(desligado.saved).toHaveLength(0);

    const ligado = deps({ pollData: vi.fn(() => poll), copyPolls: true });
    const publishOn = createDraftPublisher(ligado);
    expect(await publishOn([m(30, { media: { className: "MessageMediaPoll" } })], null)).toEqual([
      { status: "copied", destMsgId: 30 },
    ]);
    expect(ligado.saved[0]).toMatchObject({ kind: "poll", poll });
  });

  it("botões inline só são gravados com copyButtons ligado", async () => {
    const links = [{ label: "comprar", url: "https://x.test" }];
    const d = deps({ extractInlineLinks: vi.fn(() => links), copyButtons: true });
    const publish = createDraftPublisher(d);

    await publish([m(40, { message: "oferta" })], null);

    expect(d.saved[0].inlineLinks).toEqual(links);
  });

  it("rewrite substitui texto, entities e links antes de gravar", async () => {
    const d = deps({
      rewrite: vi.fn(async () => ({
        text: "texto limpo",
        entities: [{ className: "MessageEntityBold" }],
        inlineLinks: undefined,
      })),
    });
    const publish = createDraftPublisher(d);

    await publish([m(50, { message: "texto com @concorrente" })], null);

    expect(d.saved[0].contentText).toBe("texto limpo");
    expect(d.saved[0].entities).toEqual([{ className: "MessageEntityBold" }]);
  });
});
