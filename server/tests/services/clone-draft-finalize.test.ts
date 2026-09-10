import { describe, it, expect, vi, beforeEach } from "vitest";
import { finalizarCampanhaDoRascunho } from "../../src/services/mtproto/clone/draft-finalize.js";

// Mesma dupla de mocks de ai-batching.test.ts: só as bordas (Supabase e fila),
// nunca a decisão. queue-mtproto abre uma conexão IORedis real no module-load
// se não for substituído.
const q = vi.hoisted(() => ({
  enfileiradas: [] as Array<{ kind: string; campaignId: string }>,
}));

vi.mock("../../src/queue-mtproto.js", () => ({
  enqueueMtproto: (data: { kind: string; campaignId: string }) => {
    q.enfileiradas.push(data);
    return Promise.resolve();
  },
}));

interface ChamadaDb {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  filtros: Record<string, unknown>;
}

interface RespostaDb {
  data?: unknown;
  error?: unknown;
}

const h = vi.hoisted(() => ({
  chamadas: [] as ChamadaDb[],
  responder: ((): RespostaDb => ({ data: null })) as (ch: ChamadaDb) => RespostaDb,
}));

vi.mock("../../src/db.js", () => {
  function from(table: string) {
    const ch: ChamadaDb = { table, op: "select", filtros: {} };
    const resolver = (): Promise<RespostaDb> => {
      h.chamadas.push(ch);
      return Promise.resolve(h.responder(ch));
    };
    const q2 = {
      select: () => q2,
      update: (payload: Record<string, unknown>) => {
        ch.op = "update";
        ch.payload = payload;
        return q2;
      },
      eq: (coluna: string, valor: unknown) => {
        ch.filtros[coluna] = valor;
        return q2;
      },
      in: (coluna: string, valor: unknown) => {
        ch.filtros[coluna] = valor;
        return q2;
      },
      maybeSingle: () => resolver(),
      then: (ok: (r: RespostaDb) => unknown, falha?: (e: unknown) => unknown) =>
        resolver().then(ok, falha),
    };
    return q2;
  }
  return { supabase: { from } };
});

describe("finalizarCampanhaDoRascunho", () => {
  beforeEach(() => {
    h.chamadas = [];
    h.responder = () => ({ data: { id: "camp-1" } });
    q.enfileiradas = [];
  });

  it("sem alavanca de IA: campanha vai pra 'draft' com o total renumerado e nada é enfileirado", async () => {
    const ok = await finalizarCampanhaDoRascunho("camp-1", 12, false);

    expect(ok).toBe(true);
    const escrita = h.chamadas.find((c) => c.op === "update");
    expect(escrita?.payload).toMatchObject({
      total_messages: 12,
      status: "draft",
      ai_status: "idle",
    });
    expect(q.enfileiradas).toEqual([]);
  });

  it("com alavanca de IA: vai pra 'ai_processing'/'queued' e enfileira campaign.ai-process", async () => {
    const ok = await finalizarCampanhaDoRascunho("camp-1", 3, true);

    expect(ok).toBe(true);
    const escrita = h.chamadas.find((c) => c.op === "update");
    expect(escrita?.payload).toMatchObject({ status: "ai_processing", ai_status: "queued" });
    expect(q.enfileiradas).toEqual([{ kind: "campaign.ai-process", campaignId: "camp-1" }]);
  });

  it("a escrita é presa aos estados de rascunho, não só ao id", async () => {
    await finalizarCampanhaDoRascunho("camp-1", 3, false);

    const escrita = h.chamadas.find((c) => c.op === "update");
    expect(escrita?.filtros.id).toBe("camp-1");
    expect(escrita?.filtros.status).toEqual(["draft", "ai_processing"]);
  });

  it("campanha já publicando: não escreve nada nela e NÃO enfileira a IA", async () => {
    // Bloqueador da revisão. Re-rodar um clone cuja campanha já foi publicada
    // resetava o status e sobrescrevia total_messages no meio da sequência —
    // e o poller, que só enfileira status='running', parava sem erro nenhum.
    h.responder = () => ({ data: null }); // CAS não pegou nenhuma linha
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ok = await finalizarCampanhaDoRascunho("camp-rodando", 99, true);

    expect(ok).toBe(false);
    expect(q.enfileiradas).toEqual([]);
    expect(warnSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toMatch(
      /camp-rodando/,
    );
    warnSpy.mockRestore();
  });
});
