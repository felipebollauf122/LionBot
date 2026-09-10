import { describe, it, expect } from "vitest";
import { GrammyError } from "grammy";
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

/**
 * Rate limit da Bot API, que é por onde o clone e as campanhas agendadas
 * publicam de verdade. Shape sem nada em comum com o do gramjs: nem `seconds`,
 * nem "FLOOD" no texto — só `error_code: 429` e `parameters.retry_after`.
 */
describe("extractWaitSeconds — 429 da Bot API (grammy)", () => {
  function grammy429(retryAfter?: number): GrammyError {
    const description =
      retryAfter === undefined
        ? "Too Many Requests"
        : `Too Many Requests: retry after ${retryAfter}`;
    return new GrammyError(
      `Call to 'sendMessage' failed! (429: ${description})`,
      {
        ok: false,
        error_code: 429,
        description,
        parameters: retryAfter === undefined ? {} : { retry_after: retryAfter },
      },
      "sendMessage",
      {},
    );
  }

  it("lê retry_after de um GrammyError 429 real", () => {
    const err = grammy429(30);
    // guarda de sanidade: nem "FLOOD" no texto, nem campo `seconds`.
    expect(err.message).not.toMatch(/FLOOD/i);
    expect((err as unknown as { seconds?: number }).seconds).toBeUndefined();
    expect(extractWaitSeconds(err)).toBe(30);
  });

  it("aceita o mesmo shape em objeto solto (erro forjado ou wrapper)", () => {
    expect(
      extractWaitSeconds({ error_code: 429, parameters: { retry_after: 12 } }),
    ).toBe(12);
  });

  it("429 sem retry_after devolve null — não há espera pra agendar", () => {
    expect(extractWaitSeconds(grammy429())).toBeNull();
  });

  it("outro erro da Bot API não vira flood", () => {
    const err = new GrammyError(
      "Call to 'sendMessage' failed! (400: Bad Request: chat not found)",
      { ok: false, error_code: 400, description: "Bad Request: chat not found" },
      "sendMessage",
      {},
    );
    expect(extractWaitSeconds(err)).toBeNull();
  });
});
