import { describe, it, expect } from "vitest";
import { FloodWaitError, SlowModeWaitError } from "telegram/errors/index.js";
import { extractWaitSeconds } from "../../src/services/mtproto/flood.js";

describe("extractWaitSeconds", () => {
  it("lê os segundos de um FloodWaitError real da lib", () => {
    const err = new FloodWaitError({
      request: undefined as never,
      capture: 42,
    } as never);
    // guarda de sanidade: a mensagem NÃO contém a palavra FLOOD.
    expect(err.message).not.toMatch(/FLOOD/i);
    expect(extractWaitSeconds(err)).toBe(42);
  });

  it("lê os segundos de um SlowModeWaitError real da lib", () => {
    const err = new SlowModeWaitError({
      request: undefined as never,
      capture: 7,
    } as never);
    expect(extractWaitSeconds(err)).toBe(7);
  });

  it("devolve null para erro comum", () => {
    expect(extractWaitSeconds(new Error("CHAT_WRITE_FORBIDDEN"))).toBeNull();
  });

  it("aceita objeto com seconds e mensagem de flood explícita (retrocompat)", () => {
    expect(extractWaitSeconds(Object.assign(new Error("FLOOD_WAIT_30"), { seconds: 30 }))).toBe(30);
  });
});
