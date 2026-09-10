import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import {
  launchClone,
  pauseClone,
  deleteClone,
  removeAutomationBot,
  clearAccountRestriction,
  createCloneJob,
} from "@/app/dashboard/automations/clones/actions";
import {
  criarSupabaseFake,
  type ChamadaFake,
  type RespostaFake,
} from "../helpers/fake-supabase";

/**
 * `app/dashboard/automations/clones/actions.ts` na convenção do branch.
 *
 * O docblock de `comGuarda` em `scheduled/actions.ts` explica o porquê: um
 * erro LANÇADO de dentro de uma Server Action é apagado pelo Next em
 * produção e chega ao usuário como uma string genérica em inglês. Este
 * arquivo continuava lançando em sete pontos, e cinco das funções devolviam
 * `Promise<void>` — estruturalmente incapazes de reportar uma recusa.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/admin-actions", () => ({
  resolveActingTenantId: vi.fn(async (t?: string) => t ?? "tenant-1"),
}));

const mockCreateClient = vi.mocked(createClient);
const mockAcesso = vi.mocked(requireAutomationsAccess);

function montar(responder: (ch: ChamadaFake) => RespostaFake) {
  const r = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(responder);
  mockCreateClient.mockResolvedValue(r.client);
  return r;
}

/** Tudo encontra uma linha — o caminho feliz. */
const achaTudo = (): RespostaFake => ({ data: [{ id: "x" }] });

describe("clones/actions — recusa vira dado, nunca throw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcesso.mockResolvedValue("user-1" as never);
    vi.stubEnv("NEXT_PUBLIC_BOT_SERVER_URL", "http://worker.local");
    vi.stubEnv("INTERNAL_API_SECRET", "s3gredo");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sem assinatura de automações, cada action devolve a recusa em português", async () => {
    mockAcesso.mockRejectedValue(new Error("Unauthorized"));
    montar(achaTudo);

    for (const chamar of [
      () => launchClone("j1"),
      () => pauseClone("j1"),
      () => deleteClone("j1"),
      () => removeAutomationBot("t1"),
      () => clearAccountRestriction("a1"),
    ]) {
      const r = await chamar();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Seu plano não inclui/);
    }
  });

  it("launchClone manda o segredo interno no enqueue e reporta a recusa do worker", async () => {
    montar((ch) =>
      ch.table === "clone_jobs" ? { data: { id: "j1" } } : { data: [{ id: "j1" }] },
    );
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await launchClone("j1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-internal-secret"]).toBe("s3gredo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/INTERNAL_API_SECRET/);
  });

  it("launchClone num job de outro tenant recusa em vez de sumir em silêncio", async () => {
    // Antes devolvia `void` num `return` mudo: a tela não tinha como saber.
    montar(() => ({ data: null }));

    const r = await launchClone("j-alheio");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/não encontrado/i);
  });

  it("deleteClone que não apaga nada recusa (delete sem linha não vira error no supabase-js)", async () => {
    montar(() => ({ data: [] }));

    const r = await deleteClone("j-alheio");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/não encontrado/i);
  });

  it("erro inesperado no meio vira recusa legível, não uma exceção que atravessa a action", async () => {
    mockCreateClient.mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await pauseClone("j1");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Não foi possível concluir a ação/);
    errSpy.mockRestore();
  });
});

describe("createCloneJob — job já criado nunca reporta fracasso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcesso.mockResolvedValue("user-1" as never);
  });

  const entrada = {
    dialogId: "d1",
    destTitle: "Destino",
    copyIdentity: false,
    messageLimit: null,
    throttleMs: 3000,
    copyReplies: false,
    copyPins: false,
    copyButtons: false,
    copyPolls: false,
    linkReplaceBot: "",
    linkReplaceGroup: "",
    linkReplaceChannel: "",
    mode: "draft" as const,
    aiClean: false,
    aiRewrite: false,
    aiSmartDelay: false,
  };

  /** Bot, dialog e inserts respondem; a ligação campanha->job LANÇA. */
  function comLigacaoQuebrada() {
    return montar((ch) => {
      if (ch.table === "automation_bots") return { data: { id: "bot-1" } };
      if (ch.table === "mtproto_dialogs") {
        return {
          data: {
            id: "d1",
            account_id: "acc-1",
            peer_id: "1",
            peer_type: "channel",
            peer_access_hash: "h",
            kind: "channel_owner",
            title: "Origem",
          },
        };
      }
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "insert") {
        return { data: { id: "camp-1" } };
      }
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "update") {
        // Exceção de verdade (rede, timeout, RLS), não erro do PostgREST.
        throw new Error("network down");
      }
      if (ch.table === "clone_jobs") return { data: { id: "job-1" } };
      return { data: null };
    });
  }

  it("a ligação source_clone_job_id que LANÇA não transforma um job criado em fracasso", async () => {
    // O defeito: a exceção subia pro catch geral e a action respondia
    // `{ ok: false }` com o job E a campanha já gravados. O usuário tentava
    // de novo e terminava com dois jobs e duas campanhas do mesmo canal.
    comLigacaoQuebrada();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await createCloneJob(entrada);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cloneJobId).toBe("job-1");
      expect(r.draftCampaignId).toBe("camp-1");
    }
    // A perda da ligação não some: fica registrada no log do servidor.
    expect(errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toMatch(
      /ligação campanha->job/,
    );
    errSpy.mockRestore();
  });
});
