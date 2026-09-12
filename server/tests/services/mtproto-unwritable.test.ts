import { describe, it, expect } from "vitest";
import { classifyUnwritable } from "../../src/services/mtproto/unwritable.js";

// Formato real do RPCError do gramjs: "403: CODIGO (caused by messages.SendMessage)".
const rpc = (code: string, status = 400) =>
  new Error(`${status}: ${code} (caused by messages.SendMessage)`);

describe("classifyUnwritable", () => {
  it.each([
    ["CHAT_ADMIN_REQUIRED", 400],
    ["CHAT_WRITE_FORBIDDEN", 403],
    ["USER_BANNED_IN_CHANNEL", 400],
    ["CHAT_RESTRICTED", 400],
    ["CHANNEL_PRIVATE", 400],
    ["CHANNEL_INVALID", 400],
    ["PEER_ID_INVALID", 400],
    ["TOPIC_CLOSED", 400],
    ["CHAT_SEND_PLAIN_FORBIDDEN", 403],
    ["CHAT_GUEST_SEND_FORBIDDEN", 403],
    ["USER_IS_BLOCKED", 400],
    ["USER_IS_BOT", 400],
    ["INPUT_USER_DEACTIVATED", 400],
    ["USER_PRIVACY_RESTRICTED", 403],
    ["CHAT_FORBIDDEN", 403],
    ["YOU_BLOCKED_USER", 400],
  ])("%s é recusa permanente do destino", (code, status) => {
    expect(classifyUnwritable(rpc(code, status))).toBe(code);
  });

  it("lê o código de errorMessage quando message não o traz", () => {
    const err = Object.assign(new Error("A wait is not required"), {
      errorMessage: "CHAT_WRITE_FORBIDDEN",
    });
    expect(classifyUnwritable(err)).toBe("CHAT_WRITE_FORBIDDEN");
  });

  it("aceita string crua", () => {
    expect(classifyUnwritable("400: USER_BANNED_IN_CHANNEL")).toBe("USER_BANNED_IN_CHANNEL");
  });

  it.each([
    "FLOOD_WAIT_30",
    "USERNAME_NOT_OCCUPIED",
    "USERNAME_INVALID",
    "PHONE_NOT_ON_TELEGRAM",
    "PEER_FLOOD",
    "USER_DEACTIVATED",
    "AUTH_KEY_UNREGISTERED",
    "SESSION_REVOKED",
    "PHONE_NUMBER_BANNED",
    "Timeout",
  ])("%s NÃO é recusa do destino (segue como falha/flood/fatal)", (code) => {
    expect(classifyUnwritable(rpc(code))).toBeNull();
  });

  it("devolve null pra valores sem texto", () => {
    expect(classifyUnwritable(null)).toBeNull();
    expect(classifyUnwritable(undefined)).toBeNull();
    expect(classifyUnwritable(42)).toBeNull();
  });
});
