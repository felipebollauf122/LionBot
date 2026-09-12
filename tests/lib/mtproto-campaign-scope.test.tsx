import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MtprotoCampaignForm } from "@/components/dashboard/mtproto-campaign-form";
import { listActiveAccounts, listAccountDialogs } from "@/app/dashboard/automations/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/dashboard/automations/actions", () => ({
  createCampaign: vi.fn(), launchCampaign: vi.fn(),
  listActiveAccounts: vi.fn(), listAccountDialogs: vi.fn(),
}));

const ownAccount = { id: "own-account", display_name: "Minha conta", phone_number: "+55001" };
const navesAccount = { id: "naves-account", display_name: "Conta Naves", phone_number: "+55002" };
const ownGroup = { id: "own-group", title: "Meu grupo", username: null, kind: "group_admin", peer_type: "channel", is_bot: false };
const navesGroup = { ...ownGroup, id: "naves-group", title: "Grupo do Naves" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("destinos do novo disparo acompanham o usuário e a conta selecionados", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listActiveAccounts).mockImplementation(async (tenantId) => tenantId === "naves" ? [navesAccount] : [ownAccount]);
    vi.mocked(listAccountDialogs).mockImplementation(async (accountId) => accountId === navesAccount.id ? [navesGroup] : [ownGroup]);
  });

  it("abre no Naves e leva o usuário selecionado também à consulta dos grupos", async () => {
    render(<MtprotoCampaignForm actingTenantId="naves" />);
    expect(await screen.findByText("Grupo do Naves")).toBeInTheDocument();
    expect(screen.queryByText("Meu grupo")).not.toBeInTheDocument();
    expect(listAccountDialogs).toHaveBeenCalledWith(navesAccount.id, expect.any(Object), "naves");
  });

  it("trocar de usuário descarta contas, destinos e seleção anteriores", async () => {
    const { rerender } = render(<MtprotoCampaignForm actingTenantId="owner" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Meu grupo/ }));
    expect(screen.getByText(/1 selecionados/)).toBeInTheDocument();

    rerender(<MtprotoCampaignForm actingTenantId="naves" />);
    expect(screen.queryByText("Meu grupo")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 selecionados/)).not.toBeInTheDocument();
    expect(await screen.findByText("Grupo do Naves")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue(navesAccount.id);
    expect(screen.queryByRole("option", { name: "Minha conta" })).not.toBeInTheDocument();
  });

  it("uma resposta atrasada de contas do usuário anterior não substitui as do Naves", async () => {
    const oldAccounts = deferred<typeof ownAccount[]>();
    vi.mocked(listActiveAccounts).mockImplementation((tenantId) => tenantId === "owner" ? oldAccounts.promise : Promise.resolve([navesAccount]));
    const { rerender } = render(<MtprotoCampaignForm actingTenantId="owner" />);
    rerender(<MtprotoCampaignForm actingTenantId="naves" />);
    await screen.findByText("Grupo do Naves");
    await act(async () => { oldAccounts.resolve([ownAccount]); });
    expect(screen.getByRole("combobox")).toHaveValue(navesAccount.id);
    expect(screen.queryByRole("option", { name: "Minha conta" })).not.toBeInTheDocument();
  });

  it("usuário sem conta ativa não herda a conta do administrador", async () => {
    const { rerender } = render(<MtprotoCampaignForm actingTenantId="owner" />);
    await screen.findByText("Meu grupo");
    vi.mocked(listActiveAccounts).mockResolvedValue([]);
    rerender(<MtprotoCampaignForm actingTenantId="naves" />);
    await waitFor(() => expect(listActiveAccounts).toHaveBeenLastCalledWith("naves"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Meu grupo")).not.toBeInTheDocument();
  });

  it("ignora grupos que chegam depois de trocar a conta Telegram", async () => {
    const oldDialogs = deferred<typeof ownGroup[]>();
    vi.mocked(listActiveAccounts).mockResolvedValue([ownAccount, navesAccount]);
    vi.mocked(listAccountDialogs).mockImplementation((id) => id === ownAccount.id ? oldDialogs.promise : Promise.resolve([navesGroup]));
    render(<MtprotoCampaignForm actingTenantId="naves" />);
    await waitFor(() => expect(listAccountDialogs).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: navesAccount.id } });
    await screen.findByText("Grupo do Naves");
    await act(async () => { oldDialogs.resolve([ownGroup]); });
    expect(screen.getByText("Grupo do Naves")).toBeInTheDocument();
    expect(screen.queryByText("Meu grupo")).not.toBeInTheDocument();
  });

  it("remove os grupos antigos imediatamente ao trocar a conta, inclusive durante o debounce", async () => {
    vi.mocked(listActiveAccounts).mockResolvedValue([ownAccount, navesAccount]);
    render(<MtprotoCampaignForm actingTenantId="naves" />);
    await screen.findByText("Meu grupo");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: navesAccount.id } });
    expect(screen.queryByText("Meu grupo")).not.toBeInTheDocument();
    expect(await screen.findByText("Grupo do Naves")).toBeInTheDocument();
  });

  it("um atalho pendente não seleciona grupos da conta anterior", async () => {
    const oldShortcut = deferred<typeof ownGroup[]>();
    vi.mocked(listActiveAccounts).mockResolvedValue([ownAccount, navesAccount]);
    render(<MtprotoCampaignForm actingTenantId="naves" />);
    await screen.findByText("Meu grupo");
    vi.mocked(listAccountDialogs).mockReturnValueOnce(oldShortcut.promise);
    fireEvent.click(screen.getByRole("button", { name: "+ Grupos que admin" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: navesAccount.id } });
    await screen.findByText("Grupo do Naves");
    await act(async () => { oldShortcut.resolve([ownGroup]); });
    expect(screen.queryByText(/1 selecionados/)).not.toBeInTheDocument();
  });
});
