import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { ensureBotAccessOnDestination } from "@/app/dashboard/automations/scheduled/actions";

/**
 * Achado de segurança (IDOR entre tenants): `ensureBotAccessOnDestination`
 * pegava `campaignId` cru e mandava pro worker, que lê com service-role
 * (RLS não se aplica) e promove o bot com a conta MTProto de QUALQUER
 * tenant — bastava ver/adivinhar o id na URL
 * (`/dashboard/automations/scheduled/[campaignId]`). Este teste prova o
 * fechamento: uma leitura RLS-scoped decide se o campaignId é do chamador
 * ANTES de qualquer chamada ao worker.
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));

const mockCreateClient = vi.mocked(createClient);

/** Simula `supabase.from("mtproto_scheduled_campaigns").select("tenant_id").eq("id", id).maybeSingle()`. */
function fakeSupabase(row: { tenant_id: string } | null) {
  const maybeSingle = vi.fn(async () => ({ data: row }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as Awaited<ReturnType<typeof createClient>>, from, select, eq, maybeSingle };
}

describe("ensureBotAccessOnDestination — ownership antes de falar com o worker", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockCreateClient.mockReset();
  });

  it("campanha de outro tenant (RLS não devolve linha): recusa e NUNCA chama o worker", async () => {
    const fake = fakeSupabase(null);
    mockCreateClient.mockResolvedValue(fake.client);

    const r = await ensureBotAccessOnDestination("campanha-de-outro-tenant");

    // A mesma frase cobre "campanha não existe" e "campanha existe mas é de
    // outro tenant" — não é possível descobrir qual dos dois casos é este a
    // partir da resposta, que é o ponto da recusa.
    expect(r).toEqual({ ok: false, error: "Campanha não encontrada (ou sem permissão)." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("campanha do próprio tenant (RLS devolve a linha): segue e chama o worker com o campaignId e o segredo", async () => {
    const fake = fakeSupabase({ tenant_id: "tenant-1" });
    mockCreateClient.mockResolvedValue(fake.client);

    const r = await ensureBotAccessOnDestination("campanha-minha");

    expect(r).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/mtproto/ensure-bot-access");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      campaignId: "campanha-minha",
    });
    expect((init as RequestInit).headers).toMatchObject({ "x-internal-secret": expect.any(String) });
  });
});
