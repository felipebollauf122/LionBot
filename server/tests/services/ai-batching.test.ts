import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fatiarComContexto,
  processarCampanhaIa,
  handleCampaignAiProcess,
  varrerCampanhasIaTravadas,
  tickCampaignAiStuckWatchdog,
  AI_CLAIM_STALE_MS,
  type CampaignAiDeps,
  type CampaignAiWatchdogDeps,
  type DraftRowForAi,
} from "../../src/workers/campaign-ai-handler.js";
import type { AiTreatment } from "../../src/services/ai/content-treatment.js";

// Mock do enqueueMtproto pra watchdog não puxar BullMQ/ioredis de verdade no
// import (mesmo motivo dos mocks de queue.js em flow-processor.test.ts):
// tickCampaignAiStuckWatchdog importa enqueueMtproto de queue-mtproto.js, que
// abre uma conexão IORedis real no module-load se não for mockado.
const q = vi.hoisted(() => ({
  enfileiradas: [] as Array<{ kind: string; campaignId: string }>,
}));

vi.mock("../../src/queue-mtproto.js", () => ({
  enqueueMtproto: (data: { kind: string; campaignId: string }) => {
    q.enfileiradas.push(data);
    return Promise.resolve();
  },
}));

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
  ltFiltros?: Record<string, unknown>;
  limite?: number;
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
  lt: (coluna: string, valor: unknown) => FakeQuery;
  limit: (n: number) => FakeQuery;
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
      lt: (coluna, valor) => {
        ch.ltFiltros = { ...(ch.ltFiltros ?? {}), [coluna]: valor };
        return q;
      },
      limit: (n) => {
        ch.limite = n;
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

  it("erro real no claim (não é 'já reivindicado por outro'): loga e recusa, não segue", async () => {
    // Defeito: reivindicar() destructurava só `{ data }`, descartando `error`
    // — uma falha de verdade (filtro malformado, conectividade, permissão)
    // virava indistinguível do caso comum "outro worker já reivindicou". Sem
    // sinal nenhum, um erro real neste worker desassistido nunca aparecia em
    // lugar algum.
    const erro = { message: "permission denied for table mtproto_scheduled_campaigns" };
    h.responder = (ch) => {
      if (ch.table === "mtproto_scheduled_campaigns" && ch.payload?.ai_status === "processing") {
        return { data: null, error: erro };
      }
      return { data: null };
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleCampaignAiProcess("camp-err");

    expect(g.chamadasIa).toHaveLength(0);
    expect(h.chamadas.some((c) => c.table === "mtproto_scheduled_messages")).toBe(false);
    const linha = errSpy.mock.calls.map((c) => c.map(String).join(" ")).find((l) => l.includes("camp-err"));
    expect(linha).toBeDefined();
    expect(linha).toMatch(/permission denied/);
    errSpy.mockRestore();
  });

  // ───────────────────────────────────────────────────────────────────────
  // BLOQUEADOR da revisão: `finalizar` escrevia status:'draft' com apenas
  // `.eq("id", campaignId)`. Duas rotas vivas chegam nela com a campanha já
  // em 'running' (o botão Publicar não era barrado durante a IA, e o
  // watchdog reenfileirava uma campanha lançada depois do worker morrer), e
  // o resultado era uma campanha rebaixada pra 'draft' NO MEIO da sequência:
  // o poller só enfileira status='running', então a publicação simplesmente
  // parava — sem erro, sem badge, sem last_error.
  // ───────────────────────────────────────────────────────────────────────

  /** Sobe uma campanha reivindicável com uma mensagem, pra chegar em finalizar. */
  function responderComUmaMensagem(cas: (ch: ChamadaDb) => RespostaDb) {
    return (ch: ChamadaDb): RespostaDb => {
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
      return cas(ch);
    };
  }

  it("finaliza com CAS de estado: só devolve pra 'draft' quem ainda está em 'ai_processing'", async () => {
    h.responder = responderComUmaMensagem(() => ({ data: { id: "camp-1" } }));
    g.respostas = [() => ({ itens: [] })];

    await handleCampaignAiProcess("camp-1");

    const final = h.chamadas.find(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.payload?.status === "draft",
    );
    expect(final?.filtros.id).toBe("camp-1");
    // A condição que faltava: sem ela o UPDATE pega a campanha em qualquer
    // estado, inclusive 'running'.
    expect(final?.filtros.status).toBe("ai_processing");
  });

  it("campanha que saiu de 'ai_processing' no meio: NÃO volta pra 'draft', mas o resultado da IA é gravado", async () => {
    // O dono clicou em Publicar enquanto a IA rodava. O CAS não pega nenhuma
    // linha — e aí o `ai_status` PRECISA ser gravado mesmo assim: sem isso a
    // campanha ficaria em ai_status='processing' pra sempre e o watchdog
    // reenfileiraria o tratamento em loop, num alvo que já está publicando.
    h.responder = responderComUmaMensagem((ch) =>
      ch.op === "update" && ch.payload?.status === "draft" ? { data: null } : { data: { id: "x" } },
    );
    g.respostas = [() => ({ itens: [] })];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handleCampaignAiProcess("camp-1");

    const finaisCampanha = h.chamadas.filter(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.op === "update" && c.payload?.ai_status,
    );
    // A última escrita é a de consolo: ai_status/ai_error SEM tocar em status.
    const consolo = finaisCampanha.at(-1);
    expect(consolo?.payload?.ai_status).toBe("done");
    expect(consolo?.payload).not.toHaveProperty("status");
    expect(consolo?.filtros.id).toBe("camp-1");
    expect(warnSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toMatch(/camp-1/);
    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// varrerCampanhasIaTravadas — decisão do watchdog (Defeito 1: TTL sem ator).
// campaign.ai-process é enfileirado uma única vez, com attempts:2/backoff 3s
// (queue-mtproto.ts) — muito menor que AI_CLAIM_STALE_MS (10min). Se o worker
// morre no meio, o retry do BullMQ acontece cedo demais pra passar pelo CAS,
// as tentativas se esgotam e ninguém reenfileira de novo sozinho. Estes
// testes provam a DECISÃO (quais campanhas são travadas o bastante, e o que
// fazer com cada uma) com deps fabricadas, sem tocar banco nem fila — mesmo
// espírito de `processarCampanhaIa — fiação` acima.
// ─────────────────────────────────────────────────────────────────────────────

describe("varrerCampanhasIaTravadas — decisão do watchdog (sem banco)", () => {
  it("campanha travada: destrava por CAS e reenfileira", async () => {
    const destravadas: string[] = [];
    const reenfileiradas: string[] = [];
    const deps: CampaignAiWatchdogDeps = {
      listarTravadas: async () => ["camp-1"],
      destravar: async (id) => {
        destravadas.push(id);
        return true;
      },
      reenfileirar: async (id) => {
        reenfileiradas.push(id);
      },
    };

    await varrerCampanhasIaTravadas(deps);

    expect(destravadas).toEqual(["camp-1"]);
    expect(reenfileiradas).toEqual(["camp-1"]);
  });

  it("passa o limiar certo (agora - AI_CLAIM_STALE_MS) pra listarTravadas", async () => {
    const agora = new Date("2026-01-01T00:20:00.000Z");
    let staleRecebido: Date | null = null;
    const deps: CampaignAiWatchdogDeps = {
      listarTravadas: async (staleBefore) => {
        staleRecebido = staleBefore;
        return [];
      },
      destravar: async () => true,
      reenfileirar: async () => {},
    };

    await varrerCampanhasIaTravadas(deps, agora);

    expect(staleRecebido).toEqual(new Date(agora.getTime() - AI_CLAIM_STALE_MS));
  });

  it("CAS de destravar perdido (outra varredura ou o próprio worker já resolveu): não reenfileira", async () => {
    const reenfileirar = vi.fn();
    const deps: CampaignAiWatchdogDeps = {
      listarTravadas: async () => ["camp-1"],
      destravar: async () => false,
      reenfileirar,
    };

    await varrerCampanhasIaTravadas(deps);

    expect(reenfileirar).not.toHaveBeenCalled();
  });

  it("nenhuma campanha travada: não chama destravar nem reenfileirar", async () => {
    const destravar = vi.fn();
    const reenfileirar = vi.fn();
    const deps: CampaignAiWatchdogDeps = { listarTravadas: async () => [], destravar, reenfileirar };

    await varrerCampanhasIaTravadas(deps);

    expect(destravar).not.toHaveBeenCalled();
    expect(reenfileirar).not.toHaveBeenCalled();
  });

  it("várias travadas: processa todas, mesmo quando uma perde o CAS no meio", async () => {
    const reenfileiradas: string[] = [];
    const deps: CampaignAiWatchdogDeps = {
      listarTravadas: async () => ["camp-1", "camp-2", "camp-3"],
      destravar: async (id) => id !== "camp-2",
      reenfileirar: async (id) => {
        reenfileiradas.push(id);
      },
    };

    await varrerCampanhasIaTravadas(deps);

    expect(reenfileiradas).toEqual(["camp-1", "camp-3"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tickCampaignAiStuckWatchdog — fiação real (Supabase + enqueueMtproto).
// Mesma lição do Plano 2/handleCampaignAiProcess: a decisão pura acima podia
// estar perfeita e tickCampaignAiStuckWatchdog ainda assim nunca alcançá-la
// direito — estes testes provam que a fiação real monta as deps certas.
// ─────────────────────────────────────────────────────────────────────────────

describe("tickCampaignAiStuckWatchdog — fiação real (Supabase + enqueueMtproto)", () => {
  beforeEach(() => {
    h.chamadas = [];
    h.responder = () => ({ data: null });
    q.enfileiradas = [];
  });

  it("busca pelo filtro certo, destrava por CAS e reenfileira campaign.ai-process", async () => {
    h.responder = (ch) => {
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "select") {
        return { data: [{ id: "camp-1" }] };
      }
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "update" && ch.payload?.ai_status === "queued") {
        return { data: { id: "camp-1" } };
      }
      return { data: null };
    };

    await tickCampaignAiStuckWatchdog();

    const busca = h.chamadas.find((c) => c.table === "mtproto_scheduled_campaigns" && c.op === "select");
    // 'queued' junto de 'processing': a própria recuperação daqui grava
    // 'queued' antes de enfileirar, e um enqueue que falha deixava a campanha
    // no único estado que a varredura não enxergava.
    expect(busca?.filtros.ai_status).toEqual(["processing", "queued"]);
    // E nunca reanimar a IA de uma campanha que já saiu da fase.
    expect(busca?.filtros.status).toBe("ai_processing");
    // 'queued' tem ai_started_at nulo, então o limiar precisa do OR.
    expect(busca?.orExpr).toMatch(/ai_started_at\.is\.null,ai_started_at\.lt\./);

    const destrava = h.chamadas.find(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.op === "update" && c.payload?.ai_status === "queued",
    );
    expect(destrava?.filtros.id).toBe("camp-1");
    expect(destrava?.filtros.status).toBe("ai_processing");
    expect(destrava?.filtros.ai_status).toEqual(["processing", "queued"]);
    expect(destrava?.payload?.ai_started_at).toBeNull();

    expect(q.enfileiradas).toEqual([{ kind: "campaign.ai-process", campaignId: "camp-1" }]);
  });

  it("ai_status='queued' com status='ai_processing' e job nenhum na fila é reenfileirada", async () => {
    // O estado que o watchdog criava e depois não enxergava: destravar grava
    // 'queued' + ai_started_at nulo, o enqueue falha, e a campanha some da
    // varredura antiga (que só listava 'processing' com ai_started_at antigo).
    let listou = false;
    h.responder = (ch) => {
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "select") {
        // Uma campanha 'queued'/null é devolvida pelo filtro novo.
        listou = true;
        return { data: [{ id: "camp-presa" }] };
      }
      if (ch.op === "update" && ch.payload?.ai_status === "queued") {
        return { data: { id: "camp-presa" } };
      }
      return { data: null };
    };

    await tickCampaignAiStuckWatchdog();

    expect(listou).toBe(true);
    expect(q.enfileiradas).toEqual([{ kind: "campaign.ai-process", campaignId: "camp-presa" }]);
  });

  it("nenhuma travada: não reenfileira nada", async () => {
    await tickCampaignAiStuckWatchdog();

    expect(q.enfileiradas).toEqual([]);
  });

  it("destravar perde o CAS (já resolvido por outra instância): não reenfileira", async () => {
    h.responder = (ch) => {
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "select") {
        return { data: [{ id: "camp-1" }] };
      }
      // update de destravar não encontra a linha (outra instância já mudou o ai_status)
      return { data: null };
    };

    await tickCampaignAiStuckWatchdog();

    expect(q.enfileiradas).toEqual([]);
  });
});
