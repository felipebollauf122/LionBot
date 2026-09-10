import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fatiarComContexto,
  processarCampanhaIa,
  handleCampaignAiProcess,
  AI_CLAIM_STALE_MS,
  type CampaignAiDeps,
  type DraftRowForAi,
} from "../../src/workers/campaign-ai-handler.js";
import type { AiTreatment } from "../../src/services/ai/content-treatment.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks pra "handleCampaignAiProcess — fiação real" (fim do arquivo), no
// mesmo estilo de tests/services/scheduled-send.test.ts: substitui só as
// bordas do próprio Supabase e do GeminiClient, não a lógica. Os testes de
// `processarCampanhaIa` acima não tocam nesses mocks (chamam a função com
// CampaignAiDeps fabricadas na hora), então convivem sem conflito no mesmo
// arquivo — só o import do módulo carrega `supabase`/`GeminiClient`, nunca
// os usa fora do último describe.
// ─────────────────────────────────────────────────────────────────────────────

interface ChamadaDb {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  filtros: Record<string, unknown>;
  orExpr?: string;
}

interface RespostaDb {
  data?: unknown;
  error?: unknown;
}

interface FakeQuery {
  select: (...args: unknown[]) => FakeQuery;
  update: (payload: Record<string, unknown>) => FakeQuery;
  eq: (coluna: string, valor: unknown) => FakeQuery;
  in: (coluna: string, valor: unknown) => FakeQuery;
  or: (expr: string) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  maybeSingle: () => Promise<RespostaDb>;
  then: (ok: (r: RespostaDb) => unknown, falha?: (e: unknown) => unknown) => Promise<unknown>;
}

const h = vi.hoisted(() => ({
  chamadas: [] as ChamadaDb[],
  responder: ((): RespostaDb => ({ data: null })) as (ch: ChamadaDb) => RespostaDb,
}));

const g = vi.hoisted(() => ({
  chamadasIa: [] as Array<{ system: string; user: string; schema: object }>,
  respostas: [] as Array<() => { itens: unknown[] }>,
  configurado: true,
}));

vi.mock("../../src/db.js", () => {
  function from(table: string): FakeQuery {
    const ch: ChamadaDb = { table, op: "select", filtros: {} };
    const resolver = (): Promise<RespostaDb> => {
      h.chamadas.push(ch);
      return Promise.resolve(h.responder(ch));
    };
    const q: FakeQuery = {
      select: () => q,
      update: (payload) => {
        ch.op = "update";
        ch.payload = payload;
        return q;
      },
      eq: (coluna, valor) => {
        ch.filtros[coluna] = valor;
        return q;
      },
      in: (coluna, valor) => {
        ch.filtros[coluna] = valor;
        return q;
      },
      or: (expr) => {
        ch.orExpr = expr;
        return q;
      },
      order: () => q,
      maybeSingle: () => resolver(),
      then: (ok, falha) => resolver().then(ok, falha),
    };
    return q;
  }
  return { supabase: { from } };
});

vi.mock("../../src/services/ai/gemini.js", () => {
  class GeminiClient {
    constructor(
      private apiKey: string,
      _model: string,
    ) {}
    isConfigured(): boolean {
      return g.configurado;
    }
    async generateJson(prompt: { system: string; user: string; schema: object }) {
      g.chamadasIa.push(prompt);
      const i = g.chamadasIa.length - 1;
      const gerar = g.respostas[i] ?? (() => ({ itens: [] }));
      return gerar();
    }
  }
  return { GeminiClient };
});

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

// ─────────────────────────────────────────────────────────────────────────────
// processarCampanhaIa — o núcleo com deps injetadas. `fatiarComContexto` acima
// continuaria verde mesmo se ninguém jamais chamasse `buildTreatmentPrompt`
// ou `applyTreatment` (lição do Plano 2: função pura testada não prova
// fiação). Estes testes chamam applyTreatment/buildTreatmentPrompt DE
// VERDADE (não mockados) e só substituem as bordas de I/O — claim, leitura,
// chamada à IA, escrita — pra provar que a resposta do modelo produz o
// patch certo no banco, que um lote que falha não derruba os demais, e que a
// janela de contexto carrega a cauda do lote anterior no prompt de verdade.
// ─────────────────────────────────────────────────────────────────────────────

function linha(id: string, position: number, text: string): DraftRowForAi {
  return {
    id,
    contentText: text,
    contentTextOriginal: null,
    paraIa: { id, position, text, mediaKinds: [], hasButtons: false },
  };
}

interface Cenario {
  deps: CampaignAiDeps;
  patches: Array<{ id: string; patch: Record<string, unknown> }>;
  progresso: number[];
  finalizacoes: Array<{ status: string; erro: string | null }>;
  promptsRecebidos: Array<{ system: string; user: string; schema: object }>;
}

function criarDeps(opts: {
  linhas: DraftRowForAi[];
  claim?: CampaignAiDeps["reivindicar"];
  geminiConfigurado?: boolean;
  chamarIa: (prompt: { system: string; user: string; schema: object }) => Promise<{ itens: AiTreatment[] }>;
}): Cenario {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const progresso: number[] = [];
  const finalizacoes: Array<{ status: string; erro: string | null }> = [];
  const promptsRecebidos: Array<{ system: string; user: string; schema: object }> = [];

  const deps: CampaignAiDeps = {
    reivindicar:
      opts.claim ??
      (async () => ({
        opts: { clean: true, rewrite: true, smartDelay: true },
      })),
    geminiConfigurado: () => opts.geminiConfigurado ?? true,
    listarMensagens: async () => opts.linhas,
    chamarIa: async (prompt) => {
      promptsRecebidos.push(prompt);
      return opts.chamarIa(prompt);
    },
    aplicarPatch: async (id, patch) => {
      patches.push({ id, patch });
    },
    atualizarProgresso: async (_id, processadas) => {
      progresso.push(processadas);
    },
    finalizar: async (_id, status, erro) => {
      finalizacoes.push({ status, erro });
    },
  };

  return { deps, patches, progresso, finalizacoes, promptsRecebidos };
}

describe("processarCampanhaIa — fiação", () => {
  it("não reivindicada (claim perdido ou fora do estado certo): não faz mais nada", async () => {
    const chamarIa = vi.fn();
    const { deps } = criarDeps({ linhas: [linha("a", 0, "x")], claim: async () => null, chamarIa });

    await processarCampanhaIa("camp-1", deps);

    expect(chamarIa).not.toHaveBeenCalled();
  });

  it("Gemini não configurado: finaliza 'failed' sem tentar nenhum lote", async () => {
    const chamarIa = vi.fn();
    const listarMensagens = vi.fn(async () => [linha("a", 0, "x")]);
    const { deps, finalizacoes } = criarDeps({ linhas: [linha("a", 0, "x")], geminiConfigurado: false, chamarIa });
    deps.listarMensagens = listarMensagens;

    await processarCampanhaIa("camp-1", deps);

    expect(chamarIa).not.toHaveBeenCalled();
    // Nem chega a consultar as mensagens: falha antes de gastar a query.
    expect(listarMensagens).not.toHaveBeenCalled();
    expect(finalizacoes).toEqual([
      { status: "failed", erro: expect.stringMatching(/GEMINI_API_KEY/) },
    ]);
  });

  it("uma resposta real do modelo produz a escrita real de applyTreatment", async () => {
    // A prova central da lição do Plano 2: não mocko applyTreatment, deixo
    // rodar de verdade. Se alguém quebrar a fiação (ex.: parar de chamar
    // applyTreatment, ou passar os campos errados), este teste cai.
    const linhas = [linha("a", 0, "texto original com @concorrente")];
    const { deps, patches, progresso, finalizacoes } = criarDeps({
      linhas,
      chamarIa: async () => ({
        itens: [
          {
            id: "a",
            action: "clean",
            text: "texto original limpo",
            delaySeconds: 500,
            reason: "",
          },
        ],
      }),
    });

    await processarCampanhaIa("camp-1", deps);

    expect(patches).toEqual([
      {
        id: "a",
        patch: {
          content_text: "texto original limpo",
          ai_action: "cleaned",
          content_text_original: "texto original com @concorrente",
          delay_seconds: 500,
        },
      },
    ]);
    expect(progresso).toEqual([1]);
    expect(finalizacoes).toEqual([{ status: "done", erro: null }]);
  });

  it("mensagem que a IA omitiu na resposta não é tocada", async () => {
    const linhas = [linha("a", 0, "x"), linha("b", 1, "y")];
    const { deps, patches } = criarDeps({
      linhas,
      chamarIa: async () => ({
        itens: [{ id: "a", action: "keep", text: null, delaySeconds: 900, reason: "" }],
      }),
    });

    await processarCampanhaIa("camp-1", deps);

    expect(patches.find((p) => p.id === "b")).toBeUndefined();
  });

  it("ideia-guia 1: item de contexto tratado pelo modelo (por engano) nunca vira patch aplicado", async () => {
    // O contexto é só leitura. 22 linhas forçam 2 lotes reais: lote 2 é
    // [m20,m21] com contexto [m18,m19] (cauda do lote 1). Mesmo que a
    // resposta do 2º lote traga (por erro) um item cujo id é o de uma
    // mensagem de CONTEXTO (m19), ela não pode ser gravada — o loop de
    // aplicação percorre só `lote`, nunca `contexto`, então "m19" nunca é
    // procurada na resposta pra esse lote.
    const linhas = Array.from({ length: 22 }, (_, i) => linha(`m${i}`, i, `texto ${i}`));
    let chamada = 0;
    const { deps, patches } = criarDeps({
      linhas,
      chamarIa: async () => {
        chamada++;
        if (chamada === 2) {
          return {
            itens: [
              { id: "m19", action: "discard", text: null, delaySeconds: 900, reason: "vazou" },
              { id: "m20", action: "keep", text: null, delaySeconds: 900, reason: "" },
            ],
          };
        }
        return { itens: [] };
      },
    });

    await processarCampanhaIa("camp-1", deps);

    expect(patches.find((p) => p.id === "m19")).toBeUndefined();
  });

  it("ideia-guia 1: o lote seguinte leva a cauda do lote anterior no prompt real de buildTreatmentPrompt", async () => {
    // TAMANHO_LOTE é 20 e JANELA_CONTEXTO é 2 dentro do módulo — não são
    // parametrizáveis de fora, então montamos 22 linhas pra forçar 2 lotes
    // reais (20 + 2) e inspecionamos o `user` do prompt de verdade que
    // buildTreatmentPrompt gerou pro segundo lote.
    const linhas = Array.from({ length: 22 }, (_, i) => linha(`m${i}`, i, `texto ${i}`));
    const { deps, promptsRecebidos } = criarDeps({
      linhas,
      chamarIa: async () => ({ itens: [] }),
    });

    await processarCampanhaIa("camp-1", deps);

    expect(promptsRecebidos).toHaveLength(2);
    const promptLote2 = promptsRecebidos[1].user;
    // As duas últimas do lote 1 (m18, m19) precisam estar no prompt do lote 2
    // como contexto — sem isso a IA decide o delay do primeiro item do lote 2
    // (m20) sem saber o que veio antes.
    expect(promptLote2).toContain("texto 18");
    expect(promptLote2).toContain("texto 19");
    expect(promptLote2).toContain("(contexto)");
    // E o próprio prompt do lote 1 não tem seção de contexto nenhuma.
    expect(promptsRecebidos[0].user).not.toContain("(contexto)");
  });

  it("ideia-guia 2: um lote que lança não derruba os demais — segue e finaliza 'partial'", async () => {
    const linhas = Array.from({ length: 45 }, (_, i) => linha(`m${i}`, i, `texto ${i}`));
    let chamada = 0;
    const { deps, patches, finalizacoes } = criarDeps({
      linhas,
      chamarIa: async () => {
        chamada++;
        if (chamada === 2) throw new Error("429 quota excedida");
        return { itens: [] };
      },
    });

    await processarCampanhaIa("camp-1", deps);

    // 3 lotes: [0..19], [20..39], [40..44]. O 2º lança e é pulado; o 3º roda.
    expect(chamada).toBe(3);
    // Nenhum patch é esperado aqui (itens: [] em todo lote), o que importa é
    // que o 3º lote FOI tentado apesar do 2º ter lançado.
    expect(patches).toEqual([]);
    expect(finalizacoes).toEqual([
      { status: "partial", erro: expect.stringMatching(/lote/i) },
    ]);
  });

  it("ideia-guia 2: falha total (nenhum lote processado) é 'failed', não 'partial'", async () => {
    const linhas = Array.from({ length: 25 }, (_, i) => linha(`m${i}`, i, `texto ${i}`));
    const { deps, finalizacoes } = criarDeps({
      linhas,
      chamarIa: async () => {
        throw new Error("quota excedida");
      },
    });

    await processarCampanhaIa("camp-1", deps);

    expect(finalizacoes).toEqual([
      { status: "failed", erro: expect.stringMatching(/lote/i) },
    ]);
  });

  it("ideia-guia 2: progresso é reportado por lote, não só no fim", async () => {
    const linhas = Array.from({ length: 25 }, (_, i) => linha(`m${i}`, i, `texto ${i}`));
    const { deps, progresso } = criarDeps({ linhas, chamarIa: async () => ({ itens: [] }) });

    await processarCampanhaIa("camp-1", deps);

    expect(progresso).toEqual([20, 25]);
  });

  it("ideia-guia 3: reivindicação passa o TTL de obsolescência configurado", () => {
    // AI_CLAIM_STALE_MS precisa existir e ser o mesmo padrão de 10min de
    // processing_started_at (030) / claimed_at (050) — documentado, não
    // mágico. Testamos o valor exportado (contrato), não a query SQL em si
    // (isso pede Postgres de verdade, fora do escopo "sem rede/DB nos testes").
    expect(AI_CLAIM_STALE_MS).toBe(10 * 60 * 1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleCampaignAiProcess — fiação real. Os testes de `processarCampanhaIa`
// acima provam que a DECISÃO está certa com deps fabricadas; estes provam que
// `handleCampaignAiProcess` (a função exigida pela interface do Task 3, e a
// única chamada de fato pelo switch do mtproto-worker) monta essas deps
// LIGADAS ao Supabase e ao GeminiClient de verdade — reivindica na tabela e
// com o filtro certos, manda o prompt real pro Gemini, grava o patch real na
// tabela certa, e finaliza com o status certo. Sem isso, o mesmo buraco do
// flood no Plano 2 (função pura testada, fiação nunca alcançada) se repetiria
// aqui: `processarCampanhaIa` podia estar perfeita e `handleCampaignAiProcess`
// ainda assim nunca chamá-la direito.
// ─────────────────────────────────────────────────────────────────────────────

describe("handleCampaignAiProcess — fiação real (Supabase + GeminiClient)", () => {
  beforeEach(() => {
    h.chamadas = [];
    h.responder = () => ({ data: null });
    g.chamadasIa = [];
    g.respostas = [];
    g.configurado = true;
  });

  it("reivindica com o filtro CAS certo, manda o prompt real pro Gemini, grava o patch real e finaliza 'done'", async () => {
    h.responder = (ch) => {
      if (ch.table === "mtproto_scheduled_campaigns" && ch.payload?.ai_status === "processing") {
        return { data: { ai_clean: true, ai_rewrite: false, ai_smart_delay: false } };
      }
      if (ch.table === "mtproto_scheduled_messages" && ch.op === "select") {
        return {
          data: [
            {
              id: "m1",
              position: 0,
              content_text: "oi @concorrente",
              content_text_original: null,
              media: [],
              inline_links: null,
            },
          ],
        };
      }
      return { data: null };
    };
    g.respostas = [
      () => ({ itens: [{ id: "m1", action: "clean", text: "oi", delaySeconds: 900, reason: "" }] }),
    ];

    await handleCampaignAiProcess("camp-1");

    // Claim: update em mtproto_scheduled_campaigns, CAS por id + estado + TTL.
    const claim = h.chamadas.find(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.payload?.ai_status === "processing",
    );
    expect(claim?.filtros.id).toBe("camp-1");
    expect(claim?.filtros.ai_status).toEqual(["queued", "failed"]);
    expect(claim?.orExpr).toMatch(/ai_started_at\.is\.null,ai_started_at\.lt\./);

    // O Gemini recebeu o prompt de buildTreatmentPrompt DE VERDADE — contém
    // o texto real da mensagem lida do banco fake.
    expect(g.chamadasIa).toHaveLength(1);
    expect(g.chamadasIa[0].user).toContain("oi @concorrente");

    // O patch de applyTreatment chegou em mtproto_scheduled_messages, na
    // linha certa.
    const patchMsg = h.chamadas.find(
      (c) => c.table === "mtproto_scheduled_messages" && c.op === "update",
    );
    expect(patchMsg?.filtros.id).toBe("m1");
    expect(patchMsg?.payload?.content_text).toBe("oi");
    expect(patchMsg?.payload?.ai_action).toBe("cleaned");

    // Finalização: campanha volta a 'draft' com ai_status 'done'.
    const final = h.chamadas.find(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.payload?.status === "draft",
    );
    expect(final?.payload?.ai_status).toBe("done");
  });

  it("claim perdido (maybeSingle devolve null): não chama o Gemini nem lista mensagens", async () => {
    await handleCampaignAiProcess("camp-x");

    expect(g.chamadasIa).toHaveLength(0);
    expect(h.chamadas.some((c) => c.table === "mtproto_scheduled_messages")).toBe(false);
  });
});
