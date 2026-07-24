import { describe, it, expect } from "vitest";
import { friendlyCloneError } from "@/lib/mtproto/clone-errors";

describe("friendlyCloneError", () => {
  it("traduz USER_RESTRICTED (conta limitada pelo anti-spam)", () => {
    const msg = friendlyCloneError("403: USER_RESTRICTED (caused by channels.CreateChannel)");
    expect(msg).toMatch(/limitada/i);
    expect(msg).toMatch(/@SpamBot/);
    expect(msg).toMatch(/outra conta/i);
  });

  it("traduz PEER_FLOOD como limite de spam da conta", () => {
    expect(friendlyCloneError("420: PEER_FLOOD")).toMatch(/spam|limit/i);
  });

  it.each([
    "AUTH_KEY_UNREGISTERED",
    "SESSION_REVOKED",
    "USER_DEACTIVATED",
    "PHONE_NUMBER_BANNED",
  ])("traduz %s como conta banida/sessão expirada (reconectar)", (raw) => {
    expect(friendlyCloneError(`401: ${raw}`)).toMatch(/reconecte|banida|expirou/i);
  });

  it("traduz CHANNELS_TOO_MUCH como excesso de canais", () => {
    expect(friendlyCloneError("400: CHANNELS_TOO_MUCH")).toMatch(/canais|grupos/i);
  });

  it("traduz BOT_GROUPS_BLOCKED apontando o Group Privacy do BotFather", () => {
    expect(friendlyCloneError("400: BOT_GROUPS_BLOCKED")).toMatch(/BotFather|privacy/i);
  });

  it.each(["CHAT_ADMIN_REQUIRED", "CHAT_WRITE_FORBIDDEN"])(
    "traduz %s como bot sem permissão de postar",
    (raw) => {
      expect(friendlyCloneError(`403: ${raw}`)).toMatch(/bot|admin|postar/i);
    },
  );

  it("traduz FLOOD_WAIT informando que o clone retoma sozinho", () => {
    const msg = friendlyCloneError("A wait of 42 seconds is required (caused by messages.SendMessage)");
    expect(msg).toMatch(/esperar|flood|retoma/i);
    expect(msg).toContain("42");
  });

  it("mantém a mensagem própria de bot não cadastrado", () => {
    const raw = "bot companheiro não cadastrado — cadastre o token antes de clonar";
    // uma mensagem já legível em PT é devolvida como está
    expect(friendlyCloneError(raw)).toBe(raw);
  });

  it("devolve o erro cru quando não reconhece o código", () => {
    expect(friendlyCloneError("500: SOMETHING_WEIRD_123")).toBe("500: SOMETHING_WEIRD_123");
  });

  it("devolve null para entrada null/vazia", () => {
    expect(friendlyCloneError(null)).toBeNull();
    expect(friendlyCloneError("")).toBeNull();
  });
});
