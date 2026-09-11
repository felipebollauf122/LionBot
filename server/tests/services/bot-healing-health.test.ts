import { afterEach, describe, expect, it, vi } from "vitest";
import { isBotCredentialFailure, observeBotCredentialFailures, TelegramApiError } from "../../src/telegram/health.js";
import { TelegramApi } from "../../src/telegram/api.js";
import { GeminiClient } from "../../src/services/ai/gemini.js";

afterEach(() => { observeBotCredentialFailures(undefined); vi.unstubAllGlobals(); });
describe("bot credential health", () => {
  it.each([[401, "Unauthorized"], [403, "Forbidden: bot was deleted"], [403, "Bot is banned"]])("classifies conclusive credential errors %s %s", (code, text) => expect(isBotCredentialFailure(Number(code), String(text))).toBe(true));
  it.each([[403, "Forbidden: bot was blocked by the user"], [403, "bot was kicked from the group chat"], [400, "chat not found"], [429, "Too Many Requests"], [500, "Internal Server Error"], [404, "Not Found"]])("ignores unrelated errors %s %s", (code, text) => expect(isBotCredentialFailure(Number(code), String(text))).toBe(false));
  it("preserves the structured error while notifying detection from actual send failures", async () => {
    const observer = vi.fn(async () => {});
    observeBotCredentialFailures(observer);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 })));
    await expect(new TelegramApi("secret-token").sendMessage({ chatId: 123, text: "hello" })).rejects.toMatchObject({ error_code: 401, method: "sendMessage" });
    expect(observer).toHaveBeenCalledWith("secret-token");
  });
  it("does not let a monitoring failure mask the Telegram error", async () => {
    observeBotCredentialFailures(async () => { throw new Error("queue offline"); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 })));
    await expect(new TelegramApi("secret-token").call("getMe")).rejects.toBeInstanceOf(TelegramApiError);
  });
  it("passes every username attempt to Gemini and keeps the API key out of the URL", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "aguia2bot" }] } }] }), { status: 200 }));
    const client = new GeminiClient("secret-key", "test-model", { fetch: request });
    expect(await client.generateUsername("aguiabot", ["aguia1bot", "AGUIA1BOT"])).toBe("aguia2bot");
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "secret-key" });
    const body = JSON.parse(String(init.body));
    expect(JSON.parse(body.contents[0].parts[0].text).tentativas_rejeitadas).toEqual(["aguia1bot", "AGUIA1BOT"]);
  });
});
