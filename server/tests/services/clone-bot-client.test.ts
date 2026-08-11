import { describe, it, expect, vi } from "vitest";
import {
  validateBotToken,
  buildInlineKeyboard,
  CompanionBot,
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

/**
 * `bot` (o grammy Bot real) é privado em CompanionBot e sem seam de injeção
 * — mesmo padrão de clone-promote.test.ts pro `client` privado de
 * MtprotoClient: substitui via cast `as any` depois de construir a
 * instância, sem mudar bot-client.ts.
 */
interface FakeGrammyBot {
  api: {
    sendMessage: ReturnType<typeof vi.fn>;
    sendPhoto: ReturnType<typeof vi.fn>;
    sendSticker: ReturnType<typeof vi.fn>;
    sendMediaGroup: ReturnType<typeof vi.fn>;
    sendPoll: ReturnType<typeof vi.fn>;
    pinChatMessage: ReturnType<typeof vi.fn>;
  };
}

function makeFakeGrammyBot(): FakeGrammyBot {
  return {
    api: {
      sendMessage: vi.fn(async () => ({ message_id: 1 })),
      sendPhoto: vi.fn(async () => ({ message_id: 2 })),
      sendSticker: vi.fn(async () => ({ message_id: 3 })),
      sendMediaGroup: vi.fn(async () => [{ message_id: 4 }, { message_id: 5 }]),
      sendPoll: vi.fn(async () => ({ message_id: 6 })),
      pinChatMessage: vi.fn(async () => true),
    },
  };
}

function makeCompanionBot(): { bot: CompanionBot; fake: FakeGrammyBot } {
  const bot = new CompanionBot("123:abc", "-100999");
  const fake = makeFakeGrammyBot();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bot as any).bot = fake;
  return { bot, fake };
}

describe("CompanionBot — message_thread_id (tópicos de fórum)", () => {
  it("publishText repassa messageThreadId como message_thread_id", async () => {
    const { bot, fake } = makeCompanionBot();
    await bot.publishText("oi", { messageThreadId: 42 });
    expect(fake.api.sendMessage).toHaveBeenCalledWith(
      "-100999",
      "oi",
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("publishMedia (foto) repassa message_thread_id via o objeto common", async () => {
    const { bot, fake } = makeCompanionBot();
    await bot.publishMedia("/tmp/x.jpg", "photo", "legenda", { messageThreadId: 42 });
    expect(fake.api.sendPhoto).toHaveBeenCalledWith(
      "-100999",
      expect.anything(),
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("publishMedia (sticker) repassa message_thread_id — branch com objeto reduzido próprio", async () => {
    const { bot, fake } = makeCompanionBot();
    await bot.publishMedia("/tmp/x.webp", "sticker", "", { messageThreadId: 42 });
    expect(fake.api.sendSticker).toHaveBeenCalledWith(
      "-100999",
      expect.anything(),
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("publishAlbum repassa messageThreadId como message_thread_id", async () => {
    const { bot, fake } = makeCompanionBot();
    await bot.publishAlbum(
      [{ filePath: "/tmp/a.jpg", kind: "photo", caption: "" }],
      { messageThreadId: 42 },
    );
    expect(fake.api.sendMediaGroup).toHaveBeenCalledWith(
      "-100999",
      expect.any(Array),
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("publishPoll repassa messageThreadId como message_thread_id", async () => {
    const { bot, fake } = makeCompanionBot();
    await bot.publishPoll(
      { question: "q", options: ["a", "b"], isAnonymous: true, allowsMultipleAnswers: false },
      { messageThreadId: 42 },
    );
    expect(fake.api.sendPoll).toHaveBeenCalledWith(
      "-100999",
      "q",
      expect.any(Array),
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("pin() nunca envia message_thread_id — pinChatMessage não tem esse parâmetro na Bot API", async () => {
    const { bot, fake } = makeCompanionBot();
    await bot.pin(777);
    expect(fake.api.pinChatMessage).toHaveBeenCalledWith("-100999", 777, {
      disable_notification: true,
    });
  });
});
