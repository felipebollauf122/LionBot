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

describe("código escrito na conversa", () => {
  // Evidencia da tela: o texto foi aceito, foi ao Telegram e voltou
  // PHONE_CODE_EXPIRED no mesmo minuto, com o teclado ainda vazio. O Telegram
  // invalida o codigo no instante em que ele aparece escrito numa conversa.
  // Mandar assim mesmo so queima o codigo e culpa a pessoa com "expirou".
  it("não manda ao Telegram um código que já morreu ao ser escrito", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("22347"));
    expect(mocks.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auth.sign-in" }),
    );
  });

  it("explica por que não dá para escrever o código na conversa", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("22347"));
    const texto = String(mocks.sendMessage.mock.calls.at(-1)?.[0]?.text ?? "");
    expect(texto).toMatch(/telegram/i);
    expect(texto).toMatch(/teclado|bot(ões|oes)/i);
  });

  it("pede um código novo, já que o escrito não vale mais", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("22347"));
    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: "auth.request-code",
      accountId: "acc-1",
      phoneNumber: "+5511999999999",
    });
  });

  it("reconhece o código dentro da mensagem oficial do Telegram colada", async () => {
    await handleMtprotoLoginUpdate(
      bot,
      mensagem("Código de login: 22347. O código expira em 2 minutos."),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auth.request-code" }),
    );
  });

  // Texto que nao e codigo nao pode custar um ciclo de codigo novo: o
  // request-code tem limite de flood no Telegram.
  it("não gasta um código novo com uma mensagem que não era código", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("oi, não chegou nada aqui"));
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalled();
  });

  it("manda usar o teclado quando não achou código nenhum", async () => {
    await handleMtprotoLoginUpdate(bot, mensagem("oi"));
    const texto = String(mocks.sendMessage.mock.calls.at(-1)?.[0]?.text ?? "");
    expect(texto).toMatch(/teclado|bot(ões|oes)/i);
  });
});
