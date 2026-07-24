import { describe, it, expect } from "vitest";
import {
  validateBotToken,
  buildInlineKeyboard,
} from "../../src/services/mtproto/clone/bot-client.js";

describe("validateBotToken", () => {
  it("aceita um bot válido", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => ({ id: 555, username: "meu_bot", is_bot: true }),
    });
    expect(out).toEqual({ ok: true, botUserId: "555", username: "meu_bot" });
  });

  it("recusa token vazio sem chamar a API", async () => {
    let called = false;
    const out = await validateBotToken("  ", {
      getMe: async () => {
        called = true;
        return { id: 1, username: "x", is_bot: true };
      },
    });
    expect(out).toEqual({ ok: false, error: "token_vazio" });
    expect(called).toBe(false);
  });

  it("recusa quando a API diz que não é bot", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => ({ id: 555, username: "alguem", is_bot: false }),
    });
    expect(out).toEqual({ ok: false, error: "nao_e_bot" });
  });

  it("recusa bot sem username (não dá pra promover a admin por @)", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => ({ id: 555, is_bot: true }),
    });
    expect(out).toEqual({ ok: false, error: "bot_sem_username" });
  });

  it("converte falha da API em erro legível", async () => {
    const out = await validateBotToken("123:abc", {
      getMe: async () => {
        throw new Error("401: Unauthorized");
      },
    });
    expect(out).toEqual({ ok: false, error: "401: Unauthorized" });
  });
});

describe("buildInlineKeyboard", () => {
  it("põe um botão por linha", () => {
    expect(
      buildInlineKeyboard([
        { label: "Comprar", url: "https://a" },
        { label: "Suporte", url: "https://b" },
      ]),
    ).toEqual({
      inline_keyboard: [
        [{ text: "Comprar", url: "https://a" }],
        [{ text: "Suporte", url: "https://b" }],
      ],
    });
  });

  it("descarta botão sem url http (callback de bot alheio não funciona)", () => {
    expect(
      buildInlineKeyboard([
        { label: "Callback", url: "" },
        { label: "Ok", url: "https://a" },
      ]),
    ).toEqual({ inline_keyboard: [[{ text: "Ok", url: "https://a" }]] });
  });
});
