import { describe, it, expect } from "vitest";
import { planForMessage } from "../../src/services/mtproto/clone/media-plan.js";

function input(over: Partial<Parameters<typeof planForMessage>[0]> = {}) {
  return {
    mediaClassName: null,
    documentAttributeClassNames: [],
    hasText: true,
    copyPolls: false,
    ...over,
  };
}

describe("planForMessage", () => {
  it("mensagem só de texto vira plano de texto", () => {
    expect(planForMessage(input())).toEqual({ kind: "text" });
  });

  it("mensagem vazia sem mídia é pulada", () => {
    expect(planForMessage(input({ hasText: false }))).toEqual({
      kind: "skip",
      reason: "empty_message",
    });
  });

  it("foto vira mídia photo", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaPhoto" }))).toEqual({
      kind: "media",
      mediaKind: "photo",
    });
  });

  it("webpage degrada para texto (o preview é regerado pelo servidor)", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaWebPage" }))).toEqual({
      kind: "text",
    });
  });

  it.each([
    ["DocumentAttributeVideo", "video"],
    ["DocumentAttributeSticker", "sticker"],
    ["DocumentAttributeAnimated", "animation"],
  ])("documento com %s vira %s", (attr, expected) => {
    expect(
      planForMessage(
        input({ mediaClassName: "MessageMediaDocument", documentAttributeClassNames: [attr] }),
      ),
    ).toEqual({ kind: "media", mediaKind: expected });
  });

  it("áudio com voice ganha kind voice", () => {
    expect(
      planForMessage(
        input({
          mediaClassName: "MessageMediaDocument",
          documentAttributeClassNames: ["DocumentAttributeAudio"],
        }),
      ),
    ).toEqual({ kind: "media", mediaKind: "audio" });
  });

  it.each([
    // Sticker e GIF de verdade também carregam DocumentAttributeVideo — o
    // atributo de vídeo vem listado primeiro de propósito, pra garantir que
    // é a ORDEM dos ifs (sticker/animation antes de video) que decide, e não
    // a posição no array.
    [["DocumentAttributeVideo", "DocumentAttributeSticker"], "sticker"],
    [["DocumentAttributeVideo", "DocumentAttributeAnimated"], "animation"],
    [["DocumentAttributeVideo", "DocumentAttributeAudio"], "video"],
  ])("com atributos %j, a ordem de checagem decide %s", (attrs, expected) => {
    expect(
      planForMessage(
        input({ mediaClassName: "MessageMediaDocument", documentAttributeClassNames: attrs }),
      ),
    ).toEqual({ kind: "media", mediaKind: expected });
  });

  it("documento sem atributo conhecido vira document", () => {
    expect(
      planForMessage(input({ mediaClassName: "MessageMediaDocument" })),
    ).toEqual({ kind: "media", mediaKind: "document" });
  });

  it("enquete só entra quando o toggle está ligado", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaPoll" }))).toEqual({
      kind: "skip",
      reason: "poll_disabled",
    });
    expect(
      planForMessage(input({ mediaClassName: "MessageMediaPoll", copyPolls: true })),
    ).toEqual({ kind: "poll" });
  });

  it.each([
    ["MessageMediaGame", "media_game"],
    ["MessageMediaInvoice", "media_invoice"],
    ["MessageMediaGiveaway", "media_giveaway"],
    ["MessageMediaGiveawayResults", "media_giveaway"],
    ["MessageMediaPaidMedia", "media_paid"],
    ["MessageMediaStory", "media_story"],
    ["MessageMediaGeoLive", "media_geo_live"],
    ["MessageMediaDice", "media_dice"],
    ["MessageMediaUnsupported", "media_unsupported"],
  ])("%s é pulado com motivo %s", (className, reason) => {
    expect(planForMessage(input({ mediaClassName: className }))).toEqual({
      kind: "skip",
      reason,
    });
  });

  it("mídia desconhecida é pulada em vez de virar mensagem vazia", () => {
    expect(planForMessage(input({ mediaClassName: "MessageMediaFutura" }))).toEqual({
      kind: "skip",
      reason: "media_unknown",
    });
  });
});
