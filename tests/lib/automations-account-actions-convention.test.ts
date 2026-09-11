import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import {
  startAddAccount,
  submitAuthCode,
  submitAuthPassword,
  removeAccount,
  syncAccountDialogs,
} from "@/app/dashboard/automations/actions";
import {
  criarSupabaseFake,
  type ChamadaFake,
  type RespostaFake,
} from "../helpers/fake-supabase";

/**
 * As actions de CONTA em `app/dashboard/automations/actions.ts`, na mesma
 * convenção já provada para `clones/actions.ts` em
 * tests/lib/clone-actions-convention.test.ts.
 *
 * O defeito que originou este arquivo: sem `INTERNAL_API_SECRET` nos dois
 * lados, `/api/mtproto/enqueue` responde 503 e o `enqueueJob` LANÇAVA. Em
 * produção o Next apaga a mensagem do erro lançado de dentro de uma Server
 * Action, então o botão "Sincronizar" mostrava "An error occurred in the
 * Server Components render..." — o usuário não tinha como saber que o que
 * faltava era uma variável de ambiente.
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

const achaConta = (): RespostaFake => ({ data: { id: "acc-1" } });

describe("actions de conta — recusa vira dado, nunca throw", () => {
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

  it("worker sem INTERNAL_API_SECRET: a recusa chega legível em vez de virar exceção apagada", async () => {
    montar(achaConta);
    // 503 = o que a rota responde quando ela mesma está sem o segredo.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

    const r = await syncAccountDialogs("acc-1");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/INTERNAL_API_SECRET/);
  });

  it("worker fora do ar: erro de rede vira recusa em português, não 'fetch failed'", async () => {
    montar(achaConta);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await syncAccountDialogs("acc-1");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/servidor de automações/i);
    errSpy.mockRestore();
  });

  it("conta de outro tenant recusa com mensagem própria", async () => {
    montar(() => ({ data: null }));

    const r = await syncAccountDialogs("acc-alheia");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/não encontrada/i);
  });

  it("sincronização aceita manda o segredo interno e responde ok", async () => {
    montar(achaConta);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await syncAccountDialogs("acc-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-internal-secret"]).toBe("s3gredo");
    expect(r.ok).toBe(true);
  });

  it("sem assinatura de automações, cada action de conta devolve a recusa em português", async () => {
    mockAcesso.mockRejectedValue(new Error("Unauthorized"));
    montar(achaConta);

    for (const chamar of [
      () => startAddAccount("+5511999998888", "Principal"),
      () => submitAuthCode("acc-1", "12345"),
      () => submitAuthPassword("acc-1", "senha"),
      () => removeAccount("acc-1"),
      () => syncAccountDialogs("acc-1"),
    ]) {
      const r = await chamar();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Seu plano não inclui/);
    }
  });

  it("erro inesperado no meio vira recusa legível, não exceção atravessando a action", async () => {
    mockCreateClient.mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await removeAccount("acc-1");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Não foi possível concluir a ação/);
    errSpy.mockRestore();
  });

  it("startAddAccount devolve o id da conta criada para a tela continuar o login", async () => {
    montar((ch) => (ch.table === "mtproto_accounts" ? { data: { id: "acc-nova" } } : { data: null }));

    const r = await startAddAccount("+5511999998888", "Principal");

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accountId).toBe("acc-nova");
  });
});
