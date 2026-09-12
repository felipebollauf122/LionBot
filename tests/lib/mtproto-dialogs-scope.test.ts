import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAccountDialogs, listActiveAccounts } from "@/app/dashboard/automations/actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { createClient } from "@/lib/supabase/server";
import { criarSupabaseFake } from "../helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/admin-actions", () => ({ resolveActingTenantId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/automations-access-actions", () => ({ requireAutomationsAccess: vi.fn() }));

describe("consultas de contas e destinos respeitam o usuário escolhido pelo admin", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveActingTenantId).mockResolvedValue("naves");
  });

  it("lista apenas contas ativas do usuário resolvido no servidor", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(() => ({ data: [] }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    await listActiveAccounts("naves");
    expect(resolveActingTenantId).toHaveBeenCalledWith("naves");
    expect(fake.chamadas[0].filtros).toEqual({ tenant_id: "naves", status: "active" });
  });

  it("uma conta acessível ao admin mas de outro usuário não expõe seus grupos no disparo do Naves", async () => {
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>((query) => ({
      data: query.table === "mtproto_accounts"
        ? (query.filtros.tenant_id === "naves" ? null : { id: "own-account" })
        : [{ id: "own-group" }],
    }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    const dialogs = await listAccountDialogs("own-account", undefined, "naves");
    expect(dialogs).toEqual([]);
    expect(fake.chamadas.some((query) => query.table === "mtproto_dialogs")).toBe(false);
  });

  it("usa o usuário autenticado resolvido no servidor mesmo se o cliente pedir outro", async () => {
    vi.mocked(resolveActingTenantId).mockResolvedValue("authenticated-user");
    const fake = criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>((query) => ({
      data: query.table === "mtproto_accounts" ? { id: "account" } : [{ id: "group" }],
    }));
    vi.mocked(createClient).mockResolvedValue(fake.client);
    expect(await listAccountDialogs("account", { kinds: ["group_admin"] }, "naves")).toEqual([{ id: "group" }]);
    expect(resolveActingTenantId).toHaveBeenCalledWith("naves");
    expect(fake.chamadas[0].filtros).toEqual({ id: "account", tenant_id: "authenticated-user" });
    expect(fake.chamadas[1].filtros).toEqual({ account_id: "account", kind: ["group_admin"] });
  });
});
