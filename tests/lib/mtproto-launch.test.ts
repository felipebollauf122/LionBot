import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { launchCampaign } from "@/app/dashboard/automations/actions";
import { criarSupabaseFake } from "../helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/automations-access-actions", () => ({ requireAutomationsAccess: vi.fn(async () => "tenant") }));
vi.mock("@/lib/actions/admin-actions", () => ({ resolveActingTenantId: vi.fn() }));

describe("enviar campanha agora", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INTERNAL_API_SECRET", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_BOT_SERVER_URL", "http://worker.local");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("acorda novamente o worker se o primeiro job encontrou o agendamento antigo", async () => {
    const state = { status: "scheduled", next_run_at: "2026-09-22T23:01:56Z" as string | null };
    let retryAfter: string | null = state.next_run_at;
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(ch => {
      if (ch.op === "update") {
        if (ch.table === "mtproto_targets") retryAfter = ch.payload!.retry_after as null;
        else Object.assign(state, ch.payload);
        return { data: [{ id: "c1" }] };
      }
      return { data: { id: "c1" } };
    });
    vi.mocked(createClient).mockResolvedValue(fake.client);
    const readyJobs: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      // Simula consumo imediato da fila antes de a Server Action retornar.
      if (state.status === "running" && state.next_run_at === null && retryAfter === null) readyJobs.push("c1");
      return new Response("{}", { status: 200 });
    }));
    expect(await launchCampaign("c1")).toEqual({ ok: true });
    expect(readyJobs).toEqual(["c1"]);
  });

  it("não libera a campanha se a fila recusar a solicitação inicial", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: { id: "c1" } }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect((await launchCampaign("c1")).ok).toBe(false);
    expect(fake.chamadas.filter(ch => ch.op === "update")).toEqual([]);
  });
});
