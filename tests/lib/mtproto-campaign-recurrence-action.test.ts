import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createCampaign, updateCampaign } from "@/app/dashboard/automations/actions";
import { criarSupabaseFake, type RespostaFake } from "../helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));
vi.mock("@/lib/actions/admin-actions", () => ({
  resolveActingTenantId: vi.fn(async () => "tenant-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const entradaBase = {
  name: "Campanha",
  message: "Mensagem",
  targetsRaw: "@destino",
  delayMin: 1,
  delayMax: 1,
};

describe("createCampaign — recorrência em segundos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava um intervalo de 1 segundo sem exigir horas ou minutos", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>((ch): RespostaFake => {
      if (ch.table === "mtproto_campaigns" && ch.op === "insert") {
        return { data: { id: "campaign-1" }, error: null };
      }
      return { data: null, error: null };
    });
    vi.mocked(createClient).mockResolvedValue(fake.client);

    const result = await createCampaign({ ...entradaBase, recurrenceSeconds: 1 });

    expect(result).toEqual({ ok: true, campaignId: "campaign-1" });
    expect(fake.chamadas.find((ch) => ch.table === "mtproto_campaigns" && ch.op === "insert")?.payload)
      .toMatchObject({ recurrence_seconds: 1 });
  });

  it("recusa total zero em vez de desligar a recorrência silenciosamente", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: null }));
    vi.mocked(createClient).mockResolvedValue(fake.client);

    const result = await createCampaign({ ...entradaBase, recurrenceSeconds: 0 });

    expect(result).toEqual({ ok: false, error: "Recorrência deve ser de pelo menos 1 segundo." });
    expect(fake.chamadas).toHaveLength(0);
  });
});

describe("editar disparo", () => {
  beforeEach(() => vi.clearAllMocks());
  it("atualiza os campos sem reiniciar status nem contadores", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: [{ id: "c1" }] }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    expect(await updateCampaign("c1", { ...entradaBase, recurrenceSeconds: 2 })).toEqual({ ok: true });
    expect(fake.chamadas[0].payload).toEqual({ name: "Campanha", message_text: "Mensagem", delay_min_seconds: 1, delay_max_seconds: 1, recurrence_seconds: 2 });
    expect(fake.chamadas[0].filtros).toEqual({ id: "c1" });
  });
  it("não anuncia sucesso quando a RLS não permite editar a linha", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: [] }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    expect(await updateCampaign("c1", { ...entradaBase, recurrenceSeconds: 2 })).toEqual({ ok: false, error: "Campanha não encontrada." });
  });
  it("recusa intervalos invertidos sem gravar", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: [] }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    expect((await updateCampaign("c1", { ...entradaBase, delayMin: 4, recurrenceSeconds: 2 })).ok).toBe(false);
    expect(fake.chamadas).toHaveLength(0);
  });
});
