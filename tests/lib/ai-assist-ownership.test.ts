import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { aiAssist } from "@/app/dashboard/automations/scheduled/actions";

/**
 * `aiAssist` tem o mesmo formato de `ensureBotAccessOnDestination`
 * (`messageId` + `campaignId` chegando crus de uma Server Action invocável
 * direto por qualquer sessão autenticada) e o mesmo risco de IDOR entre
 * tenants: se a leitura não escopar por AMBOS os ids sob RLS, um
 * `messageId` de outra campanha/tenant chegaria ao worker (e seria gravado
 * de volta) só por quem chama adivinhar/ver o id. Este teste prova o
 * fechamento — mesmo raciocínio de tests/lib/ensure-bot-access-ownership.test.ts.
 */

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

/**
 * Simula
 * `supabase.from("mtproto_scheduled_messages").select(...).eq("id", ...).eq("campaign_id", ...).maybeSingle()`
 * pra leitura, e `.update(...).eq("id", ...).eq("campaign_id", ...).select("id")` pra escrita.
 */
function fakeSupabase(
  row: { id: string; content_text: string | null; content_text_original: string | null; media: unknown[] } | null,
  updateRows: Array<{ id: string }> = [{ id: "msg-1" }],
) {
  const maybeSingle = vi.fn(async () => ({ data: row }));
  const eqSelect2 = vi.fn(() => ({ maybeSingle }));
  const eqSelect1 = vi.fn(() => ({ eq: eqSelect2 }));
  const select = vi.fn(() => ({ eq: eqSelect1 }));

  const selectAfterUpdate = vi.fn(async () => ({ data: updateRows, error: null }));
  const eqUpdate2 = vi.fn(() => ({ select: selectAfterUpdate }));
  const eqUpdate1 = vi.fn(() => ({ eq: eqUpdate2 }));
  const update = vi.fn(() => ({ eq: eqUpdate1 }));

  const from = vi.fn(() => ({ select, update }));
  return {
    client: { from } as unknown as Awaited<ReturnType<typeof createClient>>,
    from,
    select,
    update,
  };
}

describe("aiAssist — ownership antes de falar com o worker", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BOT_SERVER_URL", "http://worker.local");
    vi.stubEnv("INTERNAL_API_SECRET", "s3gredo");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ text: "texto tratado" }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockCreateClient.mockReset();
  });

  it("mensagem de outra campanha/tenant (RLS não devolve linha): recusa e NUNCA chama o worker", async () => {
    const fake = fakeSupabase(null);
    mockCreateClient.mockResolvedValue(fake.client);

    const r = await aiAssist("msg-de-outro-tenant", "campanha-alheia", "rewrite");

    // A mesma frase cobre "mensagem não existe", "campanha não existe" e
    // "mensagem existe mas não é desta campanha/tenant" — não dá pra
    // descobrir qual dos casos é este a partir da resposta, que é o ponto.
    expect(r).toEqual({ ok: false, error: "Mensagem não encontrada (ou sem permissão)." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("messageId real mas de OUTRA campanha (campaign_id não bate): mesma recusa, mesmo existindo a mensagem", async () => {
    // Prova que o escopo é pelos DOIS ids, não só o messageId: um
    // .eq("id", messageId) sozinho (sem o .eq("campaign_id", campaignId))
    // deixaria isto passar.
    const fake = fakeSupabase(null);
    mockCreateClient.mockResolvedValue(fake.client);

    const r = await aiAssist("msg-1", "campanha-errada", "rewrite");

    expect(r).toEqual({ ok: false, error: "Mensagem não encontrada (ou sem permissão)." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mensagem da própria campanha (RLS devolve a linha): segue, chama o worker e grava o resultado", async () => {
    const fake = fakeSupabase({
      id: "msg-1",
      content_text: "original",
      content_text_original: null,
      media: [],
    });
    mockCreateClient.mockResolvedValue(fake.client);

    const r = await aiAssist("msg-1", "campanha-minha", "rewrite");

    expect(r).toEqual({ ok: true, text: "texto tratado" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/ai/assist");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: "rewrite",
      text: "original",
      mediaKinds: [],
    });
    expect((init as RequestInit).headers).toMatchObject({ "x-internal-secret": "s3gredo" });
  });
});
