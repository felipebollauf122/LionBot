import { describe, it, expect } from "vitest";
import { isPlainTextForbidden } from "../../src/services/mtproto/plain-forbidden.js";

describe("isPlainTextForbidden", () => {
  it("detecta pelo errorMessage cru do gramjs", () => {
    const err = Object.assign(new Error("403: CHAT_SEND_PLAIN_FORBIDDEN"), {
      errorMessage: "CHAT_SEND_PLAIN_FORBIDDEN",
    });
    expect(isPlainTextForbidden(err)).toBe(true);
  });

  it("detecta pela mensagem formatada que aparece no log de produção", () => {
    expect(
      isPlainTextForbidden(
        new Error("403: CHAT_SEND_PLAIN_FORBIDDEN (caused by messages.SendMessage)"),
      ),
    ).toBe(true);
  });

  it("aceita string crua", () => {
    expect(isPlainTextForbidden("CHAT_SEND_PLAIN_FORBIDDEN")).toBe(true);
  });

  // O escopo fechado é o ponto do módulo: quem chama APAGA o alvo. Um falso
  // positivo aqui faz alvo bom sumir da campanha sem deixar rastro.
  it("NÃO pega outros erros de permissão/flood — esses continuam sendo falha", () => {
    expect(isPlainTextForbidden(new Error("403: CHAT_WRITE_FORBIDDEN"))).toBe(false);
    expect(isPlainTextForbidden(new Error("403: CHAT_ADMIN_REQUIRED"))).toBe(false);
    expect(isPlainTextForbidden(new Error("403: USER_RESTRICTED"))).toBe(false);
    expect(isPlainTextForbidden(new Error("420: PEER_FLOOD"))).toBe(false);
    expect(isPlainTextForbidden(new Error("A wait of 42 seconds is required"))).toBe(false);
    expect(isPlainTextForbidden(new Error("USER_IS_BLOCKED"))).toBe(false);
  });

  it("não explode com entrada esquisita", () => {
    expect(isPlainTextForbidden(null)).toBe(false);
    expect(isPlainTextForbidden(undefined)).toBe(false);
    expect(isPlainTextForbidden(42)).toBe(false);
    expect(isPlainTextForbidden({})).toBe(false);
  });
});
