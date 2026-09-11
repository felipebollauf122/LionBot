import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  query: {} as Record<string, ReturnType<typeof vi.fn>>,
  enqueue: vi.fn(async () => {}),
  sendMessage: vi.fn(async () => ({ message_id: 10 })),
  editMessageText: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
}));

vi.mock("../../src/db.js", () => ({ supabase: { from: mocks.from } }));
vi.mock("../../src/queue-mtproto.js", () => ({ enqueueMtproto: mocks.enqueue }));
vi.mock("../../src/telegram/api.js", () => ({
  TelegramApi: class {
    sendMessage = mocks.sendMessage;
    editMessageText = mocks.editMessageText;
    answerCallbackQuery = mocks.answerCallbackQuery;
    sendMessageWithReplyKeyboard = vi.fn(async () => ({ message_id: 11 }));
    removeReplyKeyboard = vi.fn(async () => {});
  },
}));
vi.mock("../../src/webhook/mtproto-login-renderer.js", () => ({
  getLoginSlot: vi.fn(async () => null),
  getLoginSlotText: vi.fn(async (_b: string, _s: string, _v: unknown, fallback: string) => fallback),
  sendRenderedSequence: vi.fn(async () => {}),
}));

import { handleMtprotoLoginUpdate } from "../../src/webhook/mtproto-login-handler.js";

const bot = { id: "bot-1", tenant_id: "tenant-1", telegram_token: "token" };
const sessao = {
  id: "sess-1",
  bot_id: "bot-1",
  tenant_id: "tenant-1",
  chat_id: 55,
  telegram_user_id: 99,
  state: "awaiting_code",
  phone_number: "+5511999999999",
  code_buffer: "",
  account_id: "acc-1",
  numpad_message_id: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = Object.fromEntries(
    ["select", "eq", "update", "insert", "delete"].map((nome) => [nome, vi.fn(() => mocks.query)]),
  );
  mocks.query.maybeSingle = vi.fn(async () => ({ data: sessao, error: null }));
  mocks.query.single = vi.fn(async () => ({ data: sessao, error: null }));
  mocks.from.mockReturnValue(mocks.query);
});

const mensagem = (text: string) => ({
  message: { chat: { id: 55 }, from: { id: 99 }, text },
});

describe("código de login digitado na mensagem", () => {
  it("aceita o código digitado sozinho", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("22347"));
    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: "auth.sign-in",
      accountId: "acc-1",
      phoneNumber: "+5511999999999",
      code: "22347",
    });
  });

  // O bug relatado: a mensagem oficial do Telegram traz outro número junto, a
  // soma dos dígitos dava 6 e o código morria aqui, sem chegar ao Telegram.
  it("aceita a mensagem do Telegram com outro número no texto", async () => {
    await handleMtprotoLoginUpdate(
      bot,
      mensagem("Código de login: 22347. O código expira em 2 minutos."),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auth.sign-in", code: "22347" }),
    );
  });

  it("não manda nada ao Telegram quando não dá para achar o código", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("oi, não chegou nada aqui"));
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalled();
  });

  // A resposta antiga mandava usar o teclado, contradizendo o próprio fluxo,
  // que aceita texto. Quem digitou certo e foi recusado não tinha o que fazer.
  it("diz que dá para digitar, em vez de mandar usar só o teclado", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("oi"));
    const texto = String(mocks.sendMessage.mock.calls.at(-1)?.[0]?.text ?? "");
    expect(texto).toMatch(/digit/i);
    expect(texto).not.toMatch(/^Use o teclado abaixo/);
  });
});
