import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import {
  getBotRecovery,
  setBotRecovery,
  retryBotRecovery,
} from "@/app/dashboard/automations/bot-recovery/actions";

/**
 * Mesma convenção de `clones/actions.ts` e `scheduled/actions.ts`: erro
 * LANÇADO de dentro de uma Server Action é apagado pelo Next em produção e
 * chega ao usuário como uma string genérica em inglês. Recusa prevista
 * (sem plano, worker fora do ar, segredo trocado) é DADO.
 */

vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/admin-actions", () => ({
  resolveActingTenantId: vi.fn(async (t?: string) => t ?? "tenant-1"),
}));

const mockAcesso = vi.mocked(requireAutomationsAccess);
const botId = "20000000-0000-0000-0000-000000000001";

function respondeCom(body: unknown, status = 200) {
  // Assinatura declarada para que `mock.calls[n]` seja uma tupla tipada, e as
  // asserções sobre URL/corpo/cabeçalho passem pelo tsc junto com o resto.
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const statusOk = {
  workerEnabled: true, enabled: true, accountIds: [], backedUpAt: null,
  identityReady: false, runs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAcesso.mockResolvedValue("user-1" as never);
  vi.stubEnv("NEXT_PUBLIC_BOT_SERVER_URL", "http://worker.local");
  vi.stubEnv("INTERNAL_API_SECRET", "s3gredo");
  respondeCom(statusOk);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const acoes = [
  ["getBotRecovery", () => getBotRecovery(botId)],
  ["setBotRecovery", () => setBotRecovery(botId, true, [])],
  ["retryBotRecovery", () => retryBotRecovery(botId)],
] as const;

describe("bot-recovery/actions — recusa vira dado, nunca throw", () => {
  it.each(acoes)("%s devolve recusa de plano em vez de lançar", async (_nome, chamar) => {
    mockAcesso.mockRejectedValue(new Error("Forbidden: owner or premium only"));
    await expect(chamar()).resolves.toMatchObject({ ok: false });
    expect((await chamar() as { error: string }).error).toMatch(/plano|premium/i);
  });

  it.each(acoes)("%s devolve worker inacessível em vez de lançar", async (_nome, chamar) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const r = await chamar() as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/não respondeu|NEXT_PUBLIC_BOT_SERVER_URL/i);
  });

  it.each(acoes)("%s devolve erro inesperado como dado", async (_nome, chamar) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nao é json", { status: 200 })));
    await expect(chamar()).resolves.toMatchObject({ ok: false });
  });

  // As duas causas de 403 são MUITO diferentes: uma é o cliente sem plano, a
  // outra é configuração errada entre painel e worker. Texto único mandaria o
  // assinante conferir variável de ambiente.
  it("separa 'sem premium' de 'segredo interno trocado' no mesmo 403", async () => {
    respondeCom({ error: "healing_not_available" }, 403);
    expect((await getBotRecovery(botId) as { error: string }).error).toMatch(/premium|assinatura/i);
    respondeCom({ error: "unauthorized" }, 403);
    expect((await getBotRecovery(botId) as { error: string }).error).toMatch(/INTERNAL_API_SECRET/);
  });

  it("explica um bot que não é do tenant em vigor", async () => {
    respondeCom({ error: "bot_not_found" }, 404);
    expect((await getBotRecovery(botId) as { error: string }).error).toMatch(/bot/i);
  });

  it.each([
    ["healing_disabled", /desligad|inativ/i],
    ["no_recoverable_run", /nada|nenhuma/i],
  ])("traduz o 409 %s do retry", async (code, esperado) => {
    respondeCom({ error: code }, 409);
    expect((await retryBotRecovery(botId) as { error: string }).error).toMatch(esperado);
  });

  it("leva o tenant em vigor na query do GET e no corpo do POST", async () => {
    const get = respondeCom(statusOk);
    await getBotRecovery(botId, "tenant-9");
    expect(get.mock.calls[0][0]).toContain("tenantId=tenant-9");

    const post = respondeCom({ enabled: true, accountIds: [] });
    await setBotRecovery(botId, true, ["acc-1"], "tenant-9");
    expect(JSON.parse(String(post.mock.calls[0][1].body))).toMatchObject({
      tenantId: "tenant-9", enabled: true, accountIds: ["acc-1"],
    });
  });

  it("assina toda chamada com o segredo interno", async () => {
    const f = respondeCom(statusOk);
    await getBotRecovery(botId);
    expect(f.mock.calls[0][1].headers).toMatchObject({ "x-internal-secret": "s3gredo" });
  });

  it("devolve o status do worker no caminho feliz", async () => {
    respondeCom({ ...statusOk, identityReady: true, runs: [{ id: "r1", status: "completed" }] });
    await expect(getBotRecovery(botId)).resolves.toMatchObject({
      ok: true,
      status: { identityReady: true, workerEnabled: true },
    });
  });
});
