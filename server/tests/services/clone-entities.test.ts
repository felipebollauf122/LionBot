import { describe, it, expect } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { toBotApiEntities } from "../../src/services/mtproto/clone/entities.js";

// Defeito C1: gramjs serializa Api.MessageEntity* como {...args, className},
// SEM o campo `type` que a Bot API exige. Repassar isso direto pro grammy
// rende 400 "can't parse entities" e o clone-runner marca o grupo inteiro
// como failed. toBotApiEntities converte pro shape que a Bot API entende.
describe("toBotApiEntities", () => {
  it("undefined vira lista vazia", () => {
    expect(toBotApiEntities(undefined)).toEqual([]);
  });

  it("converte bold preservando offset/length verbatim", () => {
    const out = toBotApiEntities([new Api.MessageEntityBold({ offset: 3, length: 7 })]);
    expect(out).toEqual([{ type: "bold", offset: 3, length: 7 }]);
  });

  it("converte italic, underline, strikethrough, spoiler e code", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityItalic({ offset: 0, length: 1 }),
      new Api.MessageEntityUnderline({ offset: 1, length: 1 }),
      new Api.MessageEntityStrike({ offset: 2, length: 1 }),
      new Api.MessageEntitySpoiler({ offset: 3, length: 1 }),
      new Api.MessageEntityCode({ offset: 4, length: 1 }),
    ]);
    expect(out.map((e) => e.type)).toEqual([
      "italic",
      "underline",
      "strikethrough",
      "spoiler",
      "code",
    ]);
  });

  it("converte text_url pra text_link carregando a url", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityTextUrl({ offset: 0, length: 5, url: "https://exemplo.com" }),
    ]);
    expect(out).toEqual([
      { type: "text_link", offset: 0, length: 5, url: "https://exemplo.com" },
    ]);
  });

  it("converte pre carregando a language", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityPre({ offset: 0, length: 10, language: "typescript" }),
    ]);
    expect(out).toEqual([
      { type: "pre", offset: 0, length: 10, language: "typescript" },
    ]);
  });

  it("converte mention, hashtag, cashtag, bot_command, url, email, phone_number", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityMention({ offset: 0, length: 1 }),
      new Api.MessageEntityHashtag({ offset: 1, length: 1 }),
      new Api.MessageEntityCashtag({ offset: 2, length: 1 }),
      new Api.MessageEntityBotCommand({ offset: 3, length: 1 }),
      new Api.MessageEntityUrl({ offset: 4, length: 1 }),
      new Api.MessageEntityEmail({ offset: 5, length: 1 }),
      new Api.MessageEntityPhone({ offset: 6, length: 1 }),
    ]);
    expect(out.map((e) => e.type)).toEqual([
      "mention",
      "hashtag",
      "cashtag",
      "bot_command",
      "url",
      "email",
      "phone_number",
    ]);
  });

  it("blockquote normal vira blockquote", () => {
    const out = toBotApiEntities([new Api.MessageEntityBlockquote({ offset: 0, length: 3 })]);
    expect(out).toEqual([{ type: "blockquote", offset: 0, length: 3 }]);
  });

  it("blockquote colapsada vira expandable_blockquote", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityBlockquote({ offset: 0, length: 3, collapsed: true }),
    ]);
    expect(out).toEqual([{ type: "expandable_blockquote", offset: 0, length: 3 }]);
  });

  it("descarta custom_emoji (bot sem Premium não manda)", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityCustomEmoji({ offset: 0, length: 2, documentId: bigInt(123) }),
    ]);
    expect(out).toEqual([]);
  });

  it("descarta mention_name (precisa de User completo que não temos)", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityMentionName({ offset: 0, length: 4, userId: bigInt(999) }),
    ]);
    expect(out).toEqual([]);
  });

  it("descarta classe desconhecida defensivamente", () => {
    const out = toBotApiEntities([new Api.MessageEntityUnknown({ offset: 0, length: 1 })]);
    expect(out).toEqual([]);
  });

  it("mistura entidades válidas e descartadas preservando ordem das válidas", () => {
    const out = toBotApiEntities([
      new Api.MessageEntityBold({ offset: 0, length: 4 }),
      new Api.MessageEntityCustomEmoji({ offset: 4, length: 2, documentId: bigInt(1) }),
      new Api.MessageEntityItalic({ offset: 6, length: 3 }),
    ]);
    expect(out).toEqual([
      { type: "bold", offset: 0, length: 4 },
      { type: "italic", offset: 6, length: 3 },
    ]);
  });
});
