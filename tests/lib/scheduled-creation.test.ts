import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { createEmptyCampaign } from "@/app/dashboard/automations/scheduled/actions";
import { criarSupabaseFake } from "../helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/admin-actions", () => ({ resolveActingTenantId: vi.fn(async () => "resolved-tenant") }));
vi.mock("@/lib/actions/automations-access-actions", () => ({ requireAutomationsAccess: vi.fn(async () => "user-1") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("creating scheduled drafts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the chosen name under the server-resolved tenant", async () => {
    const { client, chamadas } = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: { id: "camp-1" } }));
    vi.mocked(createClient).mockResolvedValue(client);
    expect(await createEmptyCampaign("requested-tenant", "  Semana de lançamento  ")).toEqual({ ok: true, campaignId: "camp-1" });
    expect(resolveActingTenantId).toHaveBeenCalledWith("requested-tenant");
    expect(chamadas[0].payload).toEqual({ tenant_id: "resolved-tenant", name: "Semana de lançamento", status: "draft" });
  });

  it.each(["", "   ", "x".repeat(121)])("rejects an invalid name without writing", async (name) => {
    expect((await createEmptyCampaign("tenant-1", name)).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects aggregate scope instead of creating for the wrong owner", async () => {
    expect((await createEmptyCampaign("all", "Campanha")).ok).toBe(false);
    expect(resolveActingTenantId).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reports access denial without writing", async () => {
    vi.mocked(requireAutomationsAccess).mockRejectedValueOnce(new Error("Forbidden"));
    expect((await createEmptyCampaign("tenant-1", "Campanha")).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
});
