/**
 * Cliente do Gemini.
 *
 * fetch direto, sem SDK: é o padrão do repositório pra API externa
 * (nowpayments.ts, zuckpay.ts, evpay.ts), e a dep injetada deixa este arquivo
 * testável sem rede.
 *
 * Structured output NATIVO (generationConfig.responseMimeType +
 * generationConfig.responseSchema). Arrancar JSON de markdown com regex é a
 * fonte clássica de flakiness e não entra aqui.
 *
 * Endpoint, transmissão da chave e nomes de campo confirmados em 2026-09-10
 * contra a doc oficial (ai.google.dev/api/generate-content e
 * ai.google.dev/gemini-api/docs/migrate-to-interactions): generateContent
 * segue totalmente suportado (a Interactions API em /v1beta2/interactions é
 * só "recomendada para desenvolvimento novo", não uma substituição
 * obrigatória) e é stateless — exatamente o formato de chamada única que
 * este cliente precisa, sem o gerenciamento de histórico da API nova.
 */

export interface GeminiDeps {
  fetch: typeof fetch;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiClient {
  constructor(
    private apiKey: string,
    private model: string,
    private deps: GeminiDeps = { fetch: globalThis.fetch },
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generateJson<T>(input: {
    system: string;
    user: string;
    schema: object;
  }): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error("Gemini não configurado: defina GEMINI_API_KEY no worker.");
    }

    const res = await this.deps.fetch(
      `${BASE}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: input.schema,
            temperature: 0.4,
          },
        }),
      },
    );

    if (!res.ok) {
      const detalhe = await res.text().catch(() => "");
      throw new Error(`Gemini respondeu ${res.status}: ${detalhe.slice(0, 300)}`);
    }

    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const texto = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) {
      // O modelo pode recusar por safety e devolver 200 com candidates vazio.
      // Sem esta guarda, o JSON.parse estouraria longe da causa real.
      throw new Error("Gemini devolveu 200 sem resposta utilizável (recusa ou corte).");
    }
    return JSON.parse(texto) as T;
  }
}
