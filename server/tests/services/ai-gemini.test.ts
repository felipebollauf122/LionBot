import { describe, it, expect, vi } from "vitest";
import { GeminiClient } from "../../src/services/ai/gemini.js";

/** Resposta no formato que o generateContent devolve. */
function respostaOk(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  } as unknown as Response;
}

describe("GeminiClient", () => {
  it("isConfigured é falso sem chave", () => {
    expect(new GeminiClient("", "gemini-3.8-flash").isConfigured()).toBe(false);
    expect(new GeminiClient("k", "gemini-3.8-flash").isConfigured()).toBe(true);
  });

  it("manda o schema e devolve o JSON já parseado", async () => {
    let corpo: Record<string, unknown> = {};
    let urlChamada = "";
    const fetchFake = vi.fn(async (url: string, init: RequestInit) => {
      urlChamada = url;
      corpo = JSON.parse(init.body as string);
      return respostaOk({ itens: [{ id: "a" }] });
    });

    const client = new GeminiClient("k", "gemini-3.8-flash", {
      fetch: fetchFake as unknown as typeof fetch,
    });
    const out = await client.generateJson<{ itens: Array<{ id: string }> }>({
      system: "instruções",
      user: "conteúdo",
      schema: { type: "object" },
    });

    expect(out.itens[0].id).toBe("a");
    const cfg = corpo.generationConfig as Record<string, unknown>;
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseSchema).toEqual({ type: "object" });
    // Endpoint e transmissão da chave conforme a doc oficial (ai.google.dev/api/generate-content):
    // path /v1beta/models/{model}:generateContent e chave via query param ?key=.
    expect(urlChamada).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=k",
    );
  });

  it("erro HTTP vira Error com o status, sem estourar JSON.parse", async () => {
    const fetchFake = vi.fn(
      async () =>
        ({ ok: false, status: 429, text: async () => "quota" }) as unknown as Response,
    );
    const client = new GeminiClient("k", "m", { fetch: fetchFake as unknown as typeof fetch });

    await expect(
      client.generateJson({ system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/429/);
  });

  it("resposta sem candidates vira erro legível, não undefined", async () => {
    // O modelo pode recusar (safety) e devolver 200 com candidates vazio.
    // Sem essa guarda, JSON.parse(undefined) estoura longe da causa.
    const fetchFake = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }) as unknown as Response,
    );
    const client = new GeminiClient("k", "m", { fetch: fetchFake as unknown as typeof fetch });

    await expect(
      client.generateJson({ system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/sem resposta/i);
  });

  it("chamar sem chave configurada falha antes de tocar a rede", async () => {
    const fetchFake = vi.fn();
    const client = new GeminiClient("", "m", { fetch: fetchFake as unknown as typeof fetch });

    await expect(
      client.generateJson({ system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/não configurad/i);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});

/** Resposta de erro HTTP, no formato que o generateContent devolve. */
function respostaErro(status: number, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify({ error: { code: status, status: "UNAVAILABLE" } }),
  } as unknown as Response;
}

describe("GeminiClient — sobrecarga temporária não vira falha definitiva", () => {
  it("repete o 503 e entrega o resultado da tentativa seguinte", async () => {
    const fetchFake = vi.fn()
      .mockResolvedValueOnce(respostaErro(503))
      .mockResolvedValueOnce(respostaOk({ text: "tratado" }));

    const client = new GeminiClient("k", "gemini-3.8-flash", {
      fetch: fetchFake as unknown as typeof fetch,
      sleep: async () => {},
    });
    const out = await client.generateJson<{ text: string }>({ system: "s", user: "u", schema: {} });

    expect(out.text).toBe("tratado");
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it("esgotadas as tentativas, o erro sai marcado como temporário", async () => {
    const fetchFake = vi.fn(async () => respostaErro(503));
    const client = new GeminiClient("k", "gemini-3.8-flash", {
      fetch: fetchFake as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.generateJson({ system: "s", user: "u", schema: {} }))
      .rejects.toMatchObject({ transient: true });
    expect(fetchFake).toHaveBeenCalledTimes(3);
  });

  it("respeita Retry-After em vez do próprio backoff", async () => {
    const esperas: number[] = [];
    const fetchFake = vi.fn()
      .mockResolvedValueOnce(respostaErro(429, { "retry-after": "7" }))
      .mockResolvedValueOnce(respostaOk({ text: "ok" }));

    await new GeminiClient("k", "gemini-3.8-flash", {
      fetch: fetchFake as unknown as typeof fetch,
      sleep: async (ms: number) => { esperas.push(ms); },
    }).generateJson({ system: "s", user: "u", schema: {} });

    expect(esperas[0]).toBe(7000);
  });

  it("400 é erro do nosso pedido: não repete e não é temporário", async () => {
    const fetchFake = vi.fn(async () => respostaErro(400));
    const client = new GeminiClient("k", "gemini-3.8-flash", {
      fetch: fetchFake as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.generateJson({ system: "s", user: "u", schema: {} }))
      .rejects.toMatchObject({ transient: false });
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it("queda de rede também é temporária e é repetida", async () => {
    const fetchFake = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(respostaOk({ text: "ok" }));

    const out = await new GeminiClient("k", "gemini-3.8-flash", {
      fetch: fetchFake as unknown as typeof fetch,
      sleep: async () => {},
    }).generateJson<{ text: string }>({ system: "s", user: "u", schema: {} });

    expect(out.text).toBe("ok");
  });
});
