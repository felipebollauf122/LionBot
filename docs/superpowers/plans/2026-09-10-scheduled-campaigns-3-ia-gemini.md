# Campanhas Agendadas — Plano 3: Tratamento autônomo por IA (Gemini)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois que o clone termina de raspar, o Gemini limpa menções e links do concorrente, opcionalmente reescreve os textos, decide a cadência entre os posts e marca o que não vale publicar — tudo automático e tudo reversível. E dar ao editor três botões de assistente sob demanda.

**Architecture:** A IA roda em **fase própria, depois da extração**, num job `campaign.ai-process`. É o único desenho em que o Smart Delay funciona: decidir cadência olhando uma mensagem por vez é impossível, a IA precisa ver a sequência. Lotes de 20 com janela de contexto de 2, structured output nativo, e falha de lote degrada pra `partial` em vez de derrubar o rascunho.

**Tech Stack:** `fetch` direto contra a REST API do Gemini — sem SDK, seguindo `nowpayments.ts`/`zuckpay.ts`. Vitest com `fetch` injetado, sem rede nos testes.

**Spec:** `docs/superpowers/specs/2026-09-10-scheduled-post-campaigns-design.md` §5

**Depende de:** Plano 1 completo (tabelas, colunas de IA, ramo draft) e Plano 2 Tasks 3-6 (o composer genérico e a tela, onde os botões entram).

## Global Constraints

- **Nenhuma dependência nova no `package.json`.** O Gemini entra por `fetch`, no padrão dos gateways de pagamento.
- **Nenhuma variável de ambiente pode derrubar o boot.** Toda config nova usa `envOptional`; chave vazia desativa a feature silenciosamente, como `vapidPublicKey`.
- **A chave do Gemini mora só no worker.** O Next chama o endpoint interno; não replique `GEMINI_API_KEY` no `.env` do app.
- **Falha de IA nunca derruba o rascunho.** Lote que falha é logado e pulado; o resultado final vira `partial`.
- **`content_text_original` é preenchido uma vez só.** Reescrever duas vezes não pode apagar o texto raspado.
- **Testes não tocam a rede.** `fetch` entra injetado em `GeminiDeps`.
- Rodar testes do server: `cd server && npm test`.

---

### Task 1: Cliente Gemini

**Files:**
- Create: `server/src/services/ai/gemini.ts`
- Modify: `server/src/config.ts`
- Modify: `server/.env.example`
- Test: `server/tests/services/ai-gemini.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export interface GeminiDeps { fetch: typeof fetch }`
  - `export class GeminiClient` com `isConfigured(): boolean` e `generateJson<T>(input: { system: string; user: string; schema: object }): Promise<T>`
  - `config.geminiApiKey`, `config.geminiModel`, `config.internalApiSecret`

- [ ] **Step 1: Confirmar o identificador do modelo**

Antes de escrever qualquer chamada, **confirme na documentação oficial da Google** (ai.google.dev) o identificador exato do modelo flash atual e o formato do endpoint `generateContent`. Não escreva um nome de modelo de memória. Isto JÁ FOI feito em 2026-09-10: o flash estável atual é `gemini-3.8-flash`, e o `gemini-3.8-flash` que este plano trazia de memória estava várias gerações atrás. Reconfirme mesmo assim antes de mudar o default — este texto também envelhece.

Confirme especificamente: o path (`/v1beta/models/{model}:generateContent`), como a chave é enviada (query `?key=` ou header `x-goog-api-key`), e os nomes `generationConfig.responseMimeType` / `generationConfig.responseSchema`.

- [ ] **Step 2: Escrever os testes que falham**

Crie `server/tests/services/ai-gemini.test.ts`:

```ts
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
    const fetchFake = vi.fn(async (_url: string, init: RequestInit) => {
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/ai-gemini.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar o cliente**

Crie `server/src/services/ai/gemini.ts`:

```ts
/**
 * Cliente do Gemini.
 *
 * fetch direto, sem SDK: é o padrão do repositório pra API externa
 * (nowpayments.ts, zuckpay.ts, evpay.ts), e a dep injetada deixa este arquivo
 * testável sem rede.
 *
 * Structured output NATIVO (responseMimeType + responseSchema). Arrancar JSON
 * de markdown com regex é a fonte clássica de flakiness e não entra aqui.
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
```

- [ ] **Step 5: Acrescentar a config**

Em `server/src/config.ts`, ao objeto `config`:

```ts
  // Gemini: trata o conteúdo raspado antes de virar rascunho de campanha.
  // Chave vazia desativa a feature silenciosamente, mesmo padrão do VAPID —
  // nenhuma env nova pode derrubar o boot do worker.
  geminiApiKey: envOptional("GEMINI_API_KEY", ""),
  // Trocável sem deploy. Confirme o identificador na doc da Google antes de
  // mudar o default.
  geminiModel: envOptional("GEMINI_MODEL", "gemini-3.8-flash"),
  // Segredo compartilhado Next -> worker no endpoint do assistente de IA.
  // Vazio = o endpoint recusa toda chamada.
  internalApiSecret: envOptional("INTERNAL_API_SECRET", ""),
```

E em `server/.env.example`:

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
INTERNAL_API_SECRET=
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/ai-gemini.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/ai/gemini.ts server/src/config.ts server/.env.example server/tests/services/ai-gemini.test.ts
git commit -m "feat(ai): cliente Gemini por fetch com structured output"
```

---

### Task 2: `content-treatment` — prompt e aplicação

**Files:**
- Create: `server/src/services/ai/content-treatment.ts`
- Test: `server/tests/services/ai-content-treatment.test.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces:
  - `export interface DraftMessageForAi { id: string; position: number; text: string | null; mediaKinds: string[]; hasButtons: boolean }`
  - `export interface AiTreatment { id: string; action: "keep" | "clean" | "rewrite" | "discard"; text: string | null; delaySeconds: number; reason: string }`
  - `export interface TreatmentOptions { clean: boolean; rewrite: boolean; smartDelay: boolean }`
  - `export function buildTreatmentPrompt(batch: DraftMessageForAi[], contexto: DraftMessageForAi[], opts: TreatmentOptions): { system: string; user: string; schema: object }`
  - `export function applyTreatment(row: {...}, t: AiTreatment, opts: TreatmentOptions): Record<string, unknown> | null`
  - `export const DELAY_MIN_SECONDS = 60`, `export const DELAY_MAX_SECONDS = 86400`

`applyTreatment` é onde moram as regras que **não podem depender do humor do modelo**.

- [ ] **Step 1: Escrever os testes que falham**

Crie `server/tests/services/ai-content-treatment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  applyTreatment,
  buildTreatmentPrompt,
  DELAY_MAX_SECONDS,
  DELAY_MIN_SECONDS,
  type AiTreatment,
  type DraftMessageForAi,
  type TreatmentOptions,
} from "../../src/services/ai/content-treatment.js";

function msg(id: string, over: Partial<DraftMessageForAi> = {}): DraftMessageForAi {
  return { id, position: 1, text: "texto", mediaKinds: [], hasButtons: false, ...over };
}

function linha(over: Record<string, unknown> = {}) {
  return { content_text: "original", content_text_original: null, ...over };
}

function opts(over: Partial<TreatmentOptions> = {}): TreatmentOptions {
  return { clean: true, rewrite: false, smartDelay: false, ...over };
}

function t(over: Partial<AiTreatment> = {}): AiTreatment {
  return { id: "a", action: "keep", text: null, delaySeconds: 900, reason: "", ...over };
}

describe("buildTreatmentPrompt", () => {
  it("inclui as mensagens do lote e marca as de contexto como não-editáveis", () => {
    const p = buildTreatmentPrompt(
      [msg("a", { position: 3 })],
      [msg("ctx", { position: 2, text: "anterior" })],
      opts(),
    );
    expect(p.user).toContain("anterior");
    expect(p.user).toMatch(/contexto/i);
    // A de contexto não pode voltar no resultado: ela já foi tratada.
    expect(p.user).toMatch(/não devolva|nao devolva/i);
  });

  it("as guardas duras estão no system", () => {
    const p = buildTreatmentPrompt([msg("a")], [], opts({ rewrite: true }));
    expect(p.system).toMatch(/preço|preco/i);
    expect(p.system).toMatch(/cupom/i);
    expect(p.system).toMatch(/keep/);
    expect(p.system).toContain(String(DELAY_MIN_SECONDS));
    expect(p.system).toContain(String(DELAY_MAX_SECONDS));
  });

  it("sem a alavanca de reescrita, o system proíbe a ação rewrite", () => {
    const p = buildTreatmentPrompt([msg("a")], [], opts({ rewrite: false }));
    expect(p.system).toMatch(/não use .*rewrite|nao use .*rewrite/i);
  });

  it("informa que a mensagem tem mídia, pra IA poder escrever legenda", () => {
    const p = buildTreatmentPrompt([msg("a", { text: null, mediaKinds: ["photo"] })], [], opts());
    expect(p.user).toContain("photo");
  });
});

describe("applyTreatment", () => {
  it("keep não muda nada e devolve null", () => {
    expect(applyTreatment(linha(), t({ action: "keep" }), opts())).toBeNull();
  });

  it("clean grava o texto novo e preserva o original", () => {
    const patch = applyTreatment(linha(), t({ action: "clean", text: "limpo" }), opts());
    expect(patch).toMatchObject({
      content_text: "limpo",
      content_text_original: "original",
      ai_action: "cleaned",
    });
  });

  it("o original é preservado UMA vez só: um segundo tratamento não o sobrescreve", () => {
    // Reprocessar a campanha não pode apagar o texto raspado.
    const patch = applyTreatment(
      linha({ content_text: "já limpo", content_text_original: "original de verdade" }),
      t({ action: "rewrite", text: "reescrito" }),
      opts({ rewrite: true }),
    );
    expect(patch).toMatchObject({ content_text: "reescrito" });
    expect(patch).not.toHaveProperty("content_text_original");
  });

  it("rewrite com a alavanca desligada degrada pra cleaned", () => {
    // Um modelo que devolve rewrite sem autorização não pode parafrasear:
    // a alavanca desligada é uma decisão do dono, não uma sugestão.
    const patch = applyTreatment(linha(), t({ action: "rewrite", text: "parafraseado" }), opts());
    expect(patch).toMatchObject({ ai_action: "cleaned" });
  });

  it("discard marca a linha e guarda o motivo, sem apagar o texto", () => {
    const patch = applyTreatment(
      linha(),
      t({ action: "discard", reason: "anúncio do concorrente" }),
      opts(),
    );
    expect(patch).toMatchObject({
      ai_discarded: true,
      ai_action: "discarded",
      ai_reason: "anúncio do concorrente",
    });
    expect(patch).not.toHaveProperty("content_text");
  });

  it("discard sem motivo é recusado: vira keep", () => {
    expect(applyTreatment(linha(), t({ action: "discard", reason: "" }), opts())).toBeNull();
  });

  it("delay só é aplicado com smartDelay ligado", () => {
    expect(applyTreatment(linha(), t({ delaySeconds: 300 }), opts())).toBeNull();
    expect(
      applyTreatment(linha(), t({ delaySeconds: 300 }), opts({ smartDelay: true })),
    ).toMatchObject({ delay_seconds: 300 });
  });

  it("delay fora da faixa é truncado, nunca recusado", () => {
    const curto = applyTreatment(linha(), t({ delaySeconds: 1 }), opts({ smartDelay: true }));
    expect(curto).toMatchObject({ delay_seconds: DELAY_MIN_SECONDS });

    const longo = applyTreatment(
      linha(),
      t({ delaySeconds: 999_999 }),
      opts({ smartDelay: true }),
    );
    expect(longo).toMatchObject({ delay_seconds: DELAY_MAX_SECONDS });
  });

  it("clean sem texto novo não zera a mensagem", () => {
    // text:null com action clean é o modelo dizendo "não achei o que limpar".
    // Gravar null apagaria o post inteiro.
    expect(applyTreatment(linha(), t({ action: "clean", text: null }), opts())).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/ai-content-treatment.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Crie `server/src/services/ai/content-treatment.ts`:

```ts
/**
 * Núcleo do tratamento por IA: monta o prompt e traduz a resposta em patch.
 *
 * Sem rede, sem Supabase: é aqui que moram as regras que NÃO podem depender
 * do humor do modelo (original preservado uma vez, alavanca desligada é
 * decisão e não sugestão, delay truncado na faixa segura).
 */

export const DELAY_MIN_SECONDS = 60;
export const DELAY_MAX_SECONDS = 86400;

export interface DraftMessageForAi {
  id: string;
  position: number;
  text: string | null;
  /** ['photo'], ['video'] … A IA precisa saber que há mídia pra escrever legenda. */
  mediaKinds: string[];
  hasButtons: boolean;
}

export interface AiTreatment {
  id: string;
  action: "keep" | "clean" | "rewrite" | "discard";
  /** null = mantém o texto atual. */
  text: string | null;
  delaySeconds: number;
  reason: string;
}

export interface TreatmentOptions {
  clean: boolean;
  rewrite: boolean;
  smartDelay: boolean;
}

/** Schema do structured output: o modelo devolve exatamente isto. */
const SCHEMA = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["keep", "clean", "rewrite", "discard"] },
          text: { type: "string", nullable: true },
          delaySeconds: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["id", "action", "delaySeconds", "reason"],
      },
    },
  },
  required: ["itens"],
} as const;

export function buildTreatmentPrompt(
  batch: DraftMessageForAi[],
  contexto: DraftMessageForAi[],
  opts: TreatmentOptions,
): { system: string; user: string; schema: object } {
  const system = [
    "Você prepara postagens raspadas de um canal do Telegram para republicação em outro canal.",
    "",
    "REGRAS QUE NUNCA PODEM SER QUEBRADAS:",
    "- Nunca altere preço, valor, prazo, data, número, percentual ou código de cupom.",
    "- Nunca invente link, @menção ou informação que não esteja no texto original.",
    "- Em qualquer dúvida, devolva action 'keep'. Preservar é sempre a escolha segura.",
    `- delaySeconds sempre entre ${DELAY_MIN_SECONDS} e ${DELAY_MAX_SECONDS}.`,
    "- 'discard' só para anúncio puro de outro canal/bot concorrente, ou mensagem de",
    "  serviço (entrou no grupo, mensagem fixada, mensagem apagada). Sempre com 'reason'",
    "  curto e legível para o dono do canal, em português.",
    "",
    "AÇÕES:",
    opts.clean
      ? "- 'clean': remova @menções e links de canais/bots concorrentes. NÃO mexa em mais nada do texto."
      : "- NÃO use 'clean'.",
    opts.rewrite
      ? "- 'rewrite': parafraseie para evitar plágio e ajuste o tom, preservando fatos, oferta e chamada para ação."
      : "- NÃO use 'rewrite' em hipótese alguma. Se o texto precisar de mudança além da limpeza, devolva 'keep'.",
    opts.smartDelay
      ? "- delaySeconds: escolha o intervalo até esta postagem para a sequência parecer natural para quem acompanha o canal. Teaser puxa o próximo rápido; post de venda respira mais."
      : `- delaySeconds: devolva sempre ${DELAY_MIN_SECONDS * 15}. O intervalo não está sob sua responsabilidade.`,
    "",
    "Devolva um item para CADA mensagem editável, e apenas para elas.",
  ].join("\n");

  const linhas = (m: DraftMessageForAi, editavel: boolean): string =>
    [
      `--- ${editavel ? `id: ${m.id}` : "(contexto)"} | posição ${m.position}`,
      m.mediaKinds.length > 0 ? `mídia: ${m.mediaKinds.join(", ")}` : "mídia: nenhuma",
      m.hasButtons ? "tem botões de link" : "",
      `texto: ${m.text ?? "(sem texto)"}`,
    ]
      .filter(Boolean)
      .join("\n");

  const partes: string[] = [];
  if (contexto.length > 0) {
    partes.push(
      "MENSAGENS ANTERIORES, apenas como contexto de continuidade.",
      "Elas já foram tratadas: NÃO devolva itens para elas.",
      ...contexto.map((m) => linhas(m, false)),
      "",
    );
  }
  partes.push(
    "MENSAGENS A TRATAR:",
    ...batch.map((m) => linhas(m, true)),
  );

  return { system, user: partes.join("\n"), schema: SCHEMA as unknown as object };
}

/**
 * Traduz um AiTreatment no patch da linha, ou null quando nada muda.
 *
 * Devolver null e não um objeto vazio importa: o caller pula o UPDATE inteiro,
 * o que num lote de 20 em que a IA manteve tudo economiza 20 escritas.
 */
export function applyTreatment(
  row: { content_text: string | null; content_text_original: string | null },
  t: AiTreatment,
  opts: TreatmentOptions,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  // Descarte primeiro: ele não mexe no texto, e o dono precisa poder ler o
  // que a IA reprovou pra decidir se restaura.
  if (t.action === "discard") {
    // Sem motivo não há descarte: o dono ficaria com uma mensagem riscada e
    // nenhuma explicação.
    if (t.reason.trim() === "") return null;
    patch.ai_discarded = true;
    patch.ai_action = "discarded";
    patch.ai_reason = t.reason.trim();
    return patch;
  }

  if (t.action === "clean" || t.action === "rewrite") {
    const novo = (t.text ?? "").trim();
    // text vazio com action de mudança é o modelo dizendo "não achei o que
    // mexer". Gravar isso apagaria o post inteiro.
    if (novo !== "") {
      // A alavanca desligada é decisão do dono, não sugestão: um rewrite não
      // autorizado é registrado como cleaned.
      const autorizadoRewrite = t.action === "rewrite" && opts.rewrite;
      patch.content_text = novo;
      patch.ai_action = autorizadoRewrite ? "rewritten" : "cleaned";
      // Uma vez só: reprocessar não pode apagar o texto raspado.
      if (row.content_text_original === null) {
        patch.content_text_original = row.content_text;
      }
    }
  }

  if (opts.smartDelay) {
    patch.delay_seconds = Math.min(
      DELAY_MAX_SECONDS,
      Math.max(DELAY_MIN_SECONDS, Math.round(t.delaySeconds)),
    );
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/ai-content-treatment.test.ts`
Expected: PASS, 14 testes.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ai/content-treatment.ts server/tests/services/ai-content-treatment.test.ts
git commit -m "feat(ai): prompt e aplicação do tratamento de conteúdo"
```

---

### Task 3: Worker de processamento em lote

**Files:**
- Create: `server/src/workers/campaign-ai-handler.ts`
- Modify: `server/src/queue-mtproto.ts`
- Modify: `server/src/workers/mtproto-worker.ts`
- Modify: `server/src/workers/clone-handler.ts` (o bloco de finalização do rascunho)
- Test: `server/tests/services/ai-batching.test.ts`

**Interfaces:**
- Consumes: `GeminiClient` (Task 1), `buildTreatmentPrompt`/`applyTreatment` (Task 2).
- Produces: `MtprotoJobData` ganha `{ kind: "campaign.ai-process"; campaignId: string }`; `export async function handleCampaignAiProcess(campaignId: string): Promise<void>`; `export function fatiarComContexto<T>(itens: T[], tamanho: number, contexto: number): Array<{ lote: T[]; contexto: T[] }>`.

- [ ] **Step 1: Escrever o teste que falha**

O que dá pra testar sem banco é o fatiamento com janela de contexto — e ele é exatamente onde a cadência quebra se estiver errado.

Crie `server/tests/services/ai-batching.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fatiarComContexto } from "../../src/workers/campaign-ai-handler.js";

describe("fatiarComContexto", () => {
  it("o primeiro lote não tem contexto anterior", () => {
    const out = fatiarComContexto([1, 2, 3, 4, 5], 2, 2);
    expect(out[0]).toEqual({ lote: [1, 2], contexto: [] });
  });

  it("cada lote seguinte leva as N últimas do anterior como contexto", () => {
    // Sem isso a cadência quebra na emenda: a IA não teria como saber o que
    // veio antes do primeiro item do lote.
    const out = fatiarComContexto([1, 2, 3, 4, 5, 6], 2, 2);
    expect(out[1]).toEqual({ lote: [3, 4], contexto: [1, 2] });
    expect(out[2]).toEqual({ lote: [5, 6], contexto: [3, 4] });
  });

  it("o contexto nunca ultrapassa o que existe antes", () => {
    const out = fatiarComContexto([1, 2, 3], 1, 5);
    expect(out[1].contexto).toEqual([1]);
    expect(out[2].contexto).toEqual([1, 2]);
  });

  it("lista menor que o lote vira um lote só", () => {
    expect(fatiarComContexto([1, 2], 20, 2)).toEqual([{ lote: [1, 2], contexto: [] }]);
  });

  it("lista vazia vira nenhum lote", () => {
    expect(fatiarComContexto([], 20, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/ai-batching.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Crie `server/src/workers/campaign-ai-handler.ts`:

```ts
import { supabase } from "../db.js";
import { config } from "../config.js";
import { GeminiClient } from "../services/ai/gemini.js";
import {
  applyTreatment,
  buildTreatmentPrompt,
  type AiTreatment,
  type DraftMessageForAi,
  type TreatmentOptions,
} from "../services/ai/content-treatment.js";

const TAMANHO_LOTE = 20;
const JANELA_CONTEXTO = 2;
/** Janela de obsolescência da trava, mesmo padrão de clone-handler. */
const AI_CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Fatia em lotes, cada um carregando as últimas `contexto` mensagens do lote
 * anterior apenas para leitura. Sem essa janela, a cadência quebra na emenda
 * entre lotes: a IA não tem como decidir o intervalo do primeiro item sem
 * saber o que veio antes dele.
 */
export function fatiarComContexto<T>(
  itens: T[],
  tamanho: number,
  contexto: number,
): Array<{ lote: T[]; contexto: T[] }> {
  const out: Array<{ lote: T[]; contexto: T[] }> = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    out.push({
      lote: itens.slice(i, i + tamanho),
      contexto: itens.slice(Math.max(0, i - contexto), i),
    });
  }
  return out;
}

export async function handleCampaignAiProcess(campaignId: string): Promise<void> {
  // 1) Claim CAS com TTL, mesmo padrão de 030/050. Sem isso a campanha fica
  //    presa em ai_processing pra sempre se o worker morrer no meio.
  const stale = new Date(Date.now() - AI_CLAIM_STALE_MS).toISOString();
  const { data: claimed } = await supabase
    .from("mtproto_scheduled_campaigns")
    .update({ ai_status: "processing", ai_started_at: new Date().toISOString() })
    .eq("id", campaignId)
    .in("ai_status", ["queued", "failed"])
    .or(`ai_started_at.is.null,ai_started_at.lt.${stale}`)
    .select("*")
    .maybeSingle();
  if (!claimed) {
    console.log(`[campaign-ai] ${campaignId} não reivindicada, ignorando`);
    return;
  }

  const opts: TreatmentOptions = {
    clean: claimed.ai_clean as boolean,
    rewrite: claimed.ai_rewrite as boolean,
    smartDelay: claimed.ai_smart_delay as boolean,
  };

  const gemini = new GeminiClient(config.geminiApiKey, config.geminiModel);
  if (!gemini.isConfigured()) {
    await finalizar(campaignId, "failed", "GEMINI_API_KEY não configurada no worker");
    return;
  }

  const { data: rows } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id, position, content_text, content_text_original, media, inline_links")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: true });

  const todas = (rows ?? []).map((r) => ({
    id: r.id as string,
    position: r.position as number,
    content_text: r.content_text as string | null,
    content_text_original: r.content_text_original as string | null,
    paraIa: {
      id: r.id as string,
      position: r.position as number,
      text: r.content_text as string | null,
      mediaKinds: ((r.media as Array<{ type: string }>) ?? []).map((m) => m.type),
      hasButtons: Boolean(r.inline_links),
    } satisfies DraftMessageForAi,
  }));

  let processadas = 0;
  let houveFalha = false;

  for (const { lote, contexto } of fatiarComContexto(todas, TAMANHO_LOTE, JANELA_CONTEXTO)) {
    try {
      const prompt = buildTreatmentPrompt(
        lote.map((l) => l.paraIa),
        contexto.map((c) => c.paraIa),
        opts,
      );
      const resposta = await gemini.generateJson<{ itens: AiTreatment[] }>(prompt);
      const porId = new Map(resposta.itens.map((t) => [t.id, t]));

      for (const linha of lote) {
        const t = porId.get(linha.id);
        if (!t) continue; // o modelo omitiu: mantém como está
        const patch = applyTreatment(linha, t, opts);
        if (!patch) continue;
        await supabase.from("mtproto_scheduled_messages").update(patch).eq("id", linha.id);
      }
      processadas += lote.length;
      await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ ai_processed_count: processadas })
        .eq("id", campaignId);
    } catch (err) {
      // Lote que falha NÃO derruba o rascunho: o dono prefere 80% tratado a
      // um rascunho travado esperando quota voltar.
      houveFalha = true;
      console.error(
        `[campaign-ai] lote da campanha ${campaignId} falhou (seguindo):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await finalizar(
    campaignId,
    houveFalha ? (processadas > 0 ? "partial" : "failed") : "done",
    houveFalha ? "um ou mais lotes falharam — o conteúdo não tratado ficou como veio" : null,
  );
}

/** Encerra a fase de IA e devolve a campanha pra revisão humana. */
async function finalizar(
  campaignId: string,
  aiStatus: "done" | "partial" | "failed",
  erro: string | null,
): Promise<void> {
  await supabase
    .from("mtproto_scheduled_campaigns")
    .update({ ai_status: aiStatus, ai_error: erro, status: "draft" })
    .eq("id", campaignId);
}
```

- [ ] **Step 4: Registrar o job kind**

Em `server/src/queue-mtproto.ts`:

```ts
  | { kind: "campaign.ai-process"; campaignId: string }
```

Em `server/src/workers/mtproto-worker.ts`, no `switch`:

```ts
        case "campaign.ai-process":
          return handleCampaignAiProcess(d.campaignId);
```

- [ ] **Step 5: Encadear depois do clone**

Em `server/src/workers/clone-handler.ts`, no bloco de finalização do rascunho que o Plano 1 deixou marcando `ai_status='queued'`, acrescente o enfileiramento — que o Plano 1 explicitamente adiou porque o kind ainda não existia:

```ts
          if (querIa) {
            await enqueueMtproto({ kind: "campaign.ai-process", campaignId });
          }
```

`enqueueMtproto` já está importado no arquivo.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/ai-batching.test.ts`
Expected: PASS, 5 testes.

Run: `cd server && npx tsc --noEmit && npm test`
Expected: sem erro, tudo verde.

- [ ] **Step 7: Commit**

```bash
git add server/src/workers/campaign-ai-handler.ts server/src/queue-mtproto.ts server/src/workers/mtproto-worker.ts server/src/workers/clone-handler.ts server/tests/services/ai-batching.test.ts
git commit -m "feat(ai): worker que trata o rascunho em lote com janela de contexto"
```

---

### Task 4: Endpoint do assistente sob demanda

**Files:**
- Create: `server/src/services/ai/assist.ts`
- Modify: `server/src/index.ts` (rota nova, junto de `/api/mtproto/enqueue` em ~`:558`)
- Test: `server/tests/services/ai-assist.test.ts`

**Interfaces:**
- Consumes: `GeminiClient` (Task 1).
- Produces: `export type AiAssistAction = "rewrite" | "caption" | "summarize"`; `export function buildAssistPrompt(action, texto, mediaKinds): { system; user; schema }`; `POST /api/ai/assist`.

A chave mora **só** no worker: um lugar pra configurar, um rate-limit pra aplicar, um arquivo de prompt pra manter.

- [ ] **Step 1: Escrever o teste que falha**

Crie `server/tests/services/ai-assist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAssistPrompt } from "../../src/services/ai/assist.js";

describe("buildAssistPrompt", () => {
  it("rewrite pede paráfrase preservando fatos e oferta", () => {
    const p = buildAssistPrompt("rewrite", "compre por R$ 97", []);
    expect(p.system).toMatch(/reescrev/i);
    expect(p.system).toMatch(/preço|preco/i);
    expect(p.user).toContain("R$ 97");
  });

  it("caption pede legenda a partir da mídia quando não há texto", () => {
    const p = buildAssistPrompt("caption", null, ["photo"]);
    expect(p.system).toMatch(/legenda/i);
    expect(p.user).toContain("photo");
  });

  it("summarize pede resumo curto", () => {
    const p = buildAssistPrompt("summarize", "um texto bem longo", []);
    expect(p.system).toMatch(/resum/i);
  });

  it("as três ações compartilham as mesmas guardas de preço e link", () => {
    for (const acao of ["rewrite", "caption", "summarize"] as const) {
      const p = buildAssistPrompt(acao, "texto", []);
      expect(p.system).toMatch(/preço|preco/i);
      expect(p.system).toMatch(/nunca invente/i);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run tests/services/ai-assist.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Crie `server/src/services/ai/assist.ts`:

```ts
export type AiAssistAction = "rewrite" | "caption" | "summarize";

const SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
} as const;

/** Guardas compartilhadas: valem para as três ações, sem exceção. */
const GUARDAS = [
  "Nunca altere preço, valor, prazo, data, número, percentual ou código de cupom.",
  "Nunca invente link, @menção ou informação que não esteja no original.",
  "Responda em português, no mesmo registro do texto original.",
].join("\n");

const INSTRUCAO: Record<AiAssistAction, string> = {
  rewrite:
    "Reescreva a postagem abaixo para evitar plágio, preservando fatos, oferta e chamada para ação.",
  caption:
    "Escreva uma legenda curta e persuasiva para a mídia desta postagem, no máximo duas frases.",
  summarize: "Resuma a postagem abaixo em no máximo duas frases, mantendo a chamada para ação.",
};

export function buildAssistPrompt(
  action: AiAssistAction,
  texto: string | null,
  mediaKinds: string[],
): { system: string; user: string; schema: object } {
  return {
    system: `${INSTRUCAO[action]}\n\nREGRAS:\n${GUARDAS}`,
    user: [
      mediaKinds.length > 0 ? `mídia: ${mediaKinds.join(", ")}` : "mídia: nenhuma",
      `texto: ${texto ?? "(sem texto)"}`,
    ].join("\n"),
    schema: SCHEMA as unknown as object,
  };
}
```

- [ ] **Step 4: A rota**

Em `server/src/index.ts`, junto de `/api/mtproto/enqueue`:

```ts
// Assistente de IA sob demanda, chamado pela Server Action do painel.
//
// Este endpoint tem segredo compartilhado, diferente do /api/mtproto/enqueue
// logo acima, que não tem nenhuma autenticação. Quota de LLM aberta custa
// dinheiro de um jeito que fila aberta não custa. (Fechar o enqueue é um
// débito conhecido, registrado no spec §5.5.)
app.post("/api/ai/assist", async (req, res) => {
  try {
    if (!config.internalApiSecret) {
      res.status(503).json({ error: "assistente de IA não configurado" });
      return;
    }
    if (req.headers["x-internal-secret"] !== config.internalApiSecret) {
      res.status(401).json({ error: "não autorizado" });
      return;
    }
    const { action, text, mediaKinds } = req.body as {
      action?: AiAssistAction;
      text?: string | null;
      mediaKinds?: string[];
    };
    if (action !== "rewrite" && action !== "caption" && action !== "summarize") {
      res.status(400).json({ error: "ação inválida" });
      return;
    }

    const gemini = new GeminiClient(config.geminiApiKey, config.geminiModel);
    if (!gemini.isConfigured()) {
      res.status(503).json({ error: "GEMINI_API_KEY não configurada" });
      return;
    }
    const out = await gemini.generateJson<{ text: string }>(
      buildAssistPrompt(action, text ?? null, mediaKinds ?? []),
    );
    res.json({ text: out.text });
  } catch (error) {
    console.error("[ai.assist] falhou:", error);
    res.status(500).json({ error: "assistente falhou" });
  }
});
```

com os imports de `GeminiClient`, `buildAssistPrompt` e `AiAssistAction`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd server && npx vitest run tests/services/ai-assist.test.ts`
Expected: PASS, 4 testes.

Run: `cd server && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/ai/assist.ts server/src/index.ts server/tests/services/ai-assist.test.ts
git commit -m "feat(ai): endpoint do assistente sob demanda com segredo compartilhado"
```

---

### Task 5: Botões de assistente no editor

**Files:**
- Modify: `app/dashboard/automations/scheduled/actions.ts`
- Modify: `components/dashboard/campaigns/campaign-extras.tsx`
- Modify: `components/dashboard/campaigns/campaign-composer.tsx`
- Modify: `components/dashboard/campaigns/ai-card.tsx` (criar, se ainda não existir do Plano 2)

**Interfaces:**
- Consumes: `POST /api/ai/assist` (Task 4); `ComposerActions.aiAssist` (Plano 2 Task 2).
- Produces: nada consumido adiante.

- [ ] **Step 1: A Server Action**

Em `app/dashboard/automations/scheduled/actions.ts`:

```ts
/**
 * Assistente sob demanda. Passa pelo worker (mesmo hop de enqueueClone) e
 * não chama o Gemini daqui: a chave mora só lá, em um lugar só.
 */
export async function aiAssist(
  messageId: string,
  campaignId: string,
  action: "rewrite" | "caption" | "summarize",
): Promise<ActionResult> {
  await requireAutomationsAccess();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id, content_text, content_text_original, media")
    .eq("id", messageId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Mensagem não encontrada (ou sem permissão)." };

  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  let texto: string;
  try {
    const res = await fetch(`${serverUrl}/api/ai/assist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        action,
        text: row.content_text,
        mediaKinds: ((row.media as Array<{ type: string }>) ?? []).map((m) => m.type),
      }),
    });
    if (!res.ok) {
      // Recusa prevista volta como DADO: erro lançado em Server Action é
      // apagado em produção e chega ao usuário em inglês genérico.
      return {
        ok: false,
        error:
          res.status === 503
            ? "O assistente de IA não está configurado no servidor."
            : `O assistente falhou (${res.status}). Tente de novo em instantes.`,
      };
    }
    texto = ((await res.json()) as { text: string }).text;
  } catch {
    return { ok: false, error: "Não deu pra falar com o assistente de IA." };
  }

  const patch: Record<string, unknown> = {
    content_text: texto,
    ai_action: action === "rewrite" ? "rewritten" : "cleaned",
  };
  // Uma vez só, mesma regra do tratamento em lote.
  if (row.content_text_original === null) {
    patch.content_text_original = row.content_text;
  }

  const { error } = await supabase
    .from("mtproto_scheduled_messages")
    .update(patch)
    .eq("id", messageId)
    .eq("campaign_id", campaignId);
  if (error) return { ok: false, error: `Não deu pra salvar: ${error.message}` };

  revalidatePath(`/dashboard/automations/scheduled/${campaignId}`);
  return { ok: true };
}
```

Acrescente `INTERNAL_API_SECRET` ao `.env` do app (não a chave do Gemini).

- [ ] **Step 2: Os botões**

Em `components/dashboard/campaigns/campaign-extras.tsx`, acrescente o bloco que o Plano 2 deixou explicitamente de fora:

```tsx
      {onAssist && value.id && (
        <div className="space-y-2">
          <p className="text-xs text-(--text-muted)">Assistente</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { acao: "rewrite" as const, label: "Reescrever este post" },
                { acao: "caption" as const, label: "Criar texto para a imagem" },
                { acao: "summarize" as const, label: "Resumir" },
              ]
            ).map((b) => (
              <button
                key={b.acao}
                type="button"
                disabled={ocupado}
                onClick={() => onAssist(value.id!, b.acao)}
                className="rounded-lg border border-(--border-default) px-3 py-1.5 text-xs text-(--text-secondary) hover:text-(--text-primary) hover:border-(--accent) disabled:opacity-50 transition-colors"
              >
                {b.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-(--text-muted)">
            O texto original fica salvo — dá pra reverter a qualquer momento.
          </p>
        </div>
      )}
```

com as props `onAssist?: (id: string, action: AiAssistAction) => void` e `ocupado: boolean`.

"Criar texto para a imagem" só faz sentido com mídia — desabilite quando `value.media.length === 0`, com o motivo em `title`.

- [ ] **Step 3: Ligar no composer**

Em `campaign-composer.tsx`, passe `aiAssist` nas actions:

```tsx
        aiAssist: (id, action) => aiAssist(id, campaign.id, action),
```

- [ ] **Step 4: `AiCard`**

Crie (ou complete) `components/dashboard/campaigns/ai-card.tsx` na coluna esquerda: mostra `ai_status`, `ai_processed_count / total_messages`, e `ai_error` quando houver. Em `processing`, um aviso claro:

```tsx
        <p className="text-(--text-muted) text-xs">
          A IA está tratando o conteúdo. Você já pode revisar — as mensagens vão
          se atualizando conforme ela termina cada lote.
        </p>
```

E, em `partial`, o recado honesto de que parte ficou como veio.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: tudo passa.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/automations/scheduled/actions.ts components/dashboard/campaigns
git commit -m "feat(ai): botões de assistente no editor da campanha"
```

---

### Task 6: Verificação de ponta a ponta

**Files:** nenhum.

- [ ] **Step 1: Suítes**

Run: `npm test && cd server && npm test`
Expected: suite VERDE. O `server/` roda 53 arquivos e o root 41 (contagem de 2026-09-10; ela sobe conforme o plano avança, entao compare com a sua baseline, nao com este numero) — qualquer suite que falhe ou nao carregue e regressao SUA, nao condicao pre-existente. (Ate 2026-09-10 tres suites de `tests/engine/*` nao carregavam por falta de SUPABASE_URL; isso foi corrigido em `ac945ad` e nao deve ser usado como desculpa.)

- [ ] **Step 2: Configurar e checar a degradação**

Sem `GEMINI_API_KEY` no worker:
1. Rode um clone em rascunho com as alavancas ligadas.
2. Confirme que a campanha termina em `ai_status='failed'` com `ai_error` legível, **status `draft`**, e que **todas as mensagens estão lá, sem tratamento**. O rascunho tem que continuar utilizável.

- [ ] **Step 3: Fluxo com IA de verdade**

Com a chave configurada, clone um canal que tenha `@menções` de outro canal:
1. Ligue "Limpar menções e links" e "Definir a cadência"; deixe "Reescrever" desligado.
2. Ao terminar, confirme: menções sumiram, o texto **não** foi parafraseado (alavanca desligada), `delay_seconds` variam entre as mensagens, e `content_text_original` guarda o texto raspado.
3. Na tela, use o toggle **Original / IA** e o **Reverter** numa mensagem. O texto tem que voltar exatamente ao original.
4. Se alguma vier descartada, confirme que ela aparece riscada com o motivo, e que "Restaurar" a traz de volta.

- [ ] **Step 4: Assistente manual**

Selecione uma mensagem e use "Reescrever este post". Confirme que o texto muda, que o toggle Original/IA aparece, e que reverter funciona. Numa mensagem sem mídia, confirme que "Criar texto para a imagem" está desabilitado.

- [ ] **Step 5: Guardas de conteúdo**

Numa mensagem com preço (`R$ 97`), prazo (`48 horas`) e cupom, rode "Reescrever" e **confirme que os três números continuam idênticos**. Se algum mudar, o prompt precisa de reforço — não siga adiante sem isso.

---

## Sequência de dependências

```
Task 1 (cliente) ─┬─ Task 3 (worker em lote) ─┐
                  │                            ├─ Task 6
Task 2 (prompt) ──┘                            │
Task 1 ── Task 4 (endpoint) ── Task 5 (botões) ┘
```

Tasks 1 e 2 são independentes entre si. A Task 5 exige o Plano 2 Tasks 5-6 prontos.
