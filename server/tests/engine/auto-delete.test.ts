import { describe, it, expect } from "vitest";
import { resolveAutoDeleteSeconds, AUTO_DELETE_MAX_SECONDS } from "../../src/engine/auto-delete.js";

describe("resolveAutoDeleteSeconds", () => {
  it("usa o tempo do bloco quando ele está configurado", () => {
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: 45 }, null)).toBe(45);
  });

  it("o tempo do bloco ganha do fallback do fluxo", () => {
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: 45 }, 900)).toBe(45);
  });

  it("cai no fallback do fluxo quando o bloco não tem tempo", () => {
    expect(resolveAutoDeleteSeconds({}, 900)).toBe(900);
  });

  it("devolve null quando nem bloco nem fluxo pedem deleção", () => {
    expect(resolveAutoDeleteSeconds({}, null)).toBeNull();
  });

  it("ignora valores inválidos do bloco e cai no fallback", () => {
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: 0 }, 900)).toBe(900);
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: -5 }, 900)).toBe(900);
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: "30" }, 900)).toBe(900);
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: Number.NaN }, 900)).toBe(900);
  });

  it("limita o tempo do bloco ao teto de 24h", () => {
    expect(resolveAutoDeleteSeconds({ auto_delete_seconds: 999999 }, null)).toBe(AUTO_DELETE_MAX_SECONDS);
  });
});
