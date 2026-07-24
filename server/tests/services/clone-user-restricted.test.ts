import { describe, it, expect } from "vitest";
import { isUserRestricted } from "../../src/services/mtproto/clone/user-restricted.js";

describe("isUserRestricted", () => {
  it("reconhece um RPCError com errorMessage USER_RESTRICTED", () => {
    const err = Object.assign(new Error("403: USER_RESTRICTED (caused by channels.CreateChannel)"), {
      code: 403,
      errorMessage: "USER_RESTRICTED",
    });
    expect(isUserRestricted(err)).toBe(true);
  });

  it("reconhece pela mensagem quando errorMessage não vem", () => {
    expect(isUserRestricted(new Error("403: USER_RESTRICTED (caused by channels.CreateChannel)"))).toBe(true);
  });

  it("ignora outros erros do Telegram", () => {
    expect(isUserRestricted(new Error("A wait of 42 seconds is required"))).toBe(false);
    expect(isUserRestricted(new Error("CHAT_ADMIN_REQUIRED"))).toBe(false);
  });

  it("ignora não-erros", () => {
    expect(isUserRestricted(null)).toBe(false);
    expect(isUserRestricted(undefined)).toBe(false);
    expect(isUserRestricted("USER_RESTRICTED")).toBe(true); // string crua também vale
    expect(isUserRestricted(42)).toBe(false);
  });
});
