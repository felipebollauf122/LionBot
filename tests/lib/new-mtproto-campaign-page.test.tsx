import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewCampaignPage from "@/app/dashboard/automations/new-campaign/page";
import { listActiveAccounts } from "@/app/dashboard/automations/actions";

const state = vi.hoisted(() => ({ view: "naves", admin: true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard/automations/new-campaign",
  useSearchParams: () => new URLSearchParams({ view: state.view }),
  notFound: () => { throw new Error("not found"); },
}));
vi.mock("@/lib/actions/automations-access-actions", () => ({ canAccessAutomations: async () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/actions/admin-actions", () => ({
  resolveActingTenantId: async (requested?: string) => state.admin && requested ? requested : "owner",
  resolveViewScope: async (requested?: string) => {
    if (!state.admin || !requested || requested === "mine") return { tenantId: "owner", mode: "mine", isAdmin: state.admin };
    return { tenantId: requested === "all" ? null : requested, mode: requested === "all" ? "all" : "user", isAdmin: true };
  },
  getViewableUsers: async () => [{ id: "naves", name: "Naves", email: "naves@example.test" }],
}));
vi.mock("@/app/dashboard/automations/actions", () => ({
  createCampaign: vi.fn(), launchCampaign: vi.fn(),
  listActiveAccounts: vi.fn(async () => []), listAccountDialogs: vi.fn(async () => []),
}));

describe("página de novo disparo explicita e respeita a visão selecionada", () => {
  beforeEach(() => { vi.clearAllMocks(); state.admin = true; state.view = "naves"; });

  it("mostra Naves como usuário selecionado e carrega suas contas", async () => {
    render(await NewCampaignPage({ searchParams: Promise.resolve({ view: "naves" }) }));
    expect(screen.getByRole("button", { name: "Naves" })).toBeInTheDocument();
    await waitFor(() => expect(listActiveAccounts).toHaveBeenCalledWith("naves"));
    expect(screen.getByRole("link", { name: /Voltar/ })).toHaveAttribute("href", "/dashboard/automations/campaigns?view=naves");
  });

  it("na visão Todos exige escolher um usuário antes de montar o formulário", async () => {
    state.view = "all";
    render(await NewCampaignPage({ searchParams: Promise.resolve({ view: "all" }) }));
    expect(screen.queryByRole("button", { name: "Salvar e disparar" })).not.toBeInTheDocument();
    expect(listActiveAccounts).not.toHaveBeenCalled();
    expect(screen.getByText(/Selecione um usuário/)).toBeInTheDocument();
  });

  it("?view=mine carrega o id do usuário autenticado", async () => {
    state.view = "mine";
    render(await NewCampaignPage({ searchParams: Promise.resolve({ view: "mine" }) }));
    await waitFor(() => expect(listActiveAccounts).toHaveBeenCalledWith("owner"));
  });

  it("um não admin não pode abrir o disparo de outro usuário pela URL", async () => {
    state.admin = false;
    render(await NewCampaignPage({ searchParams: Promise.resolve({ view: "naves" }) }));
    await waitFor(() => expect(listActiveAccounts).toHaveBeenCalledWith("owner"));
    expect(screen.queryByRole("button", { name: "Naves" })).not.toBeInTheDocument();
  });
});
