import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BotRecoveryPanel } from "@/components/dashboard/bot-recovery-panel";
import {
  getBotRecovery,
  setBotRecovery,
  retryBotRecovery,
} from "@/app/dashboard/automations/bot-recovery/actions";

vi.mock("@/app/dashboard/automations/bot-recovery/actions", () => ({
  getBotRecovery: vi.fn(),
  setBotRecovery: vi.fn(async () => ({ ok: true, enabled: true, accountIds: [] })),
  retryBotRecovery: vi.fn(async () => ({ ok: true, runId: "run-1" })),
}));

const mockGet = vi.mocked(getBotRecovery);
const mockSet = vi.mocked(setBotRecovery);
const mockRetry = vi.mocked(retryBotRecovery);

const bots = [{ id: "bot-1", bot_username: "lojabot", is_active: true }];
const contas = [{ id: "acc-1", display_name: "Principal", phone_number: "+5511999" }];

const status = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  status: {
    workerEnabled: true, enabled: false, accountIds: [], backedUpAt: null,
    identityReady: true, runs: [], ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(status() as never);
});

const abrir = async (nome = /lojabot/i) => {
  fireEvent.click(await screen.findByRole("button", { name: nome }));
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
};

describe("BotRecoveryPanel", () => {
  it("sem nenhum bot, manda conectar um antes", () => {
    render(<BotRecoveryPanel bots={[]} accounts={contas} />);
    expect(screen.getByText(/nenhum bot/i)).toBeInTheDocument();
  });

  // Sem conta conectada não há quem converse com o BotFather: ligar aqui só
  // produziria uma run parada em `mtproto_account_unavailable`.
  it("sem conta do Telegram conectada, avisa e não deixa ligar", async () => {
    render(<BotRecoveryPanel bots={bots} accounts={[]} />);
    await abrir();
    expect(screen.getByText(/Contas Telegram/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /recuperação automática/i })).toBeDisabled();
  });

  // Mesmo espírito do aviso de automação pausada: a tela não pode dizer
  // "ligada" enquanto o worker está com a feature desligada no servidor.
  it("avisa quando o worker está com a recuperação desligada", async () => {
    mockGet.mockResolvedValue(status({ workerEnabled: false, enabled: true }) as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    expect(await screen.findByText(/BOT_AUTO_HEAL_ENABLED/)).toBeInTheDocument();
  });

  it("avisa que ainda não há cópia da identidade para restaurar", async () => {
    mockGet.mockResolvedValue(status({ identityReady: false, enabled: true }) as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    expect(await screen.findByText(/cópia da identidade/i)).toBeInTheDocument();
  });

  it("não promete backup pendente quando a cópia já existe", async () => {
    mockGet.mockResolvedValue(status({ identityReady: true, enabled: true, backedUpAt: "2026-09-10T12:00:00Z" }) as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    expect(screen.queryByText(/ainda não existe uma cópia/i)).not.toBeInTheDocument();
  });

  it("mostra a recusa da action na tela em vez de engolir", async () => {
    mockGet.mockResolvedValue({ ok: false, error: "O servidor de automações não respondeu." } as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent(/não respondeu/i);
  });

  it("traduz o código da tentativa parada e oferece retomar", async () => {
    mockGet.mockResolvedValue(status({
      enabled: true,
      runs: [{ id: "r1", status: "needs_attention", new_username: null, retry_at: null, error_code: "all_accounts_bot_limit", created_at: "2026-09-10T12:00:00Z", updated_at: "2026-09-10T12:00:00Z" }],
    }) as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    expect(await screen.findByText(/limite de 20 bots/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith("bot-1", undefined));
  });

  it("não oferece retomar uma tentativa que já terminou", async () => {
    mockGet.mockResolvedValue(status({
      enabled: true,
      runs: [{ id: "r1", status: "completed", new_username: "lojabot2", retry_at: null, error_code: null, created_at: "2026-09-10T12:00:00Z", updated_at: "2026-09-10T12:00:00Z" }],
    }) as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    expect(await screen.findByText(/lojabot2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tentar de novo/i })).not.toBeInTheDocument();
  });

  it("salva o que foi marcado, levando o tenant em vigor", async () => {
    render(<BotRecoveryPanel bots={bots} accounts={contas} actingTenantId="tenant-9" />);
    await abrir();
    fireEvent.click(screen.getByRole("checkbox", { name: /recuperação automática/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Principal/ }));
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("bot-1", true, ["acc-1"], "tenant-9"));
  });

  it("mostra a recusa ao salvar sem fingir que salvou", async () => {
    mockSet.mockResolvedValue({ ok: false, error: "Uma das contas do Telegram selecionadas não pertence a esta conta." } as never);
    render(<BotRecoveryPanel bots={bots} accounts={contas} />);
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não pertence/i);
  });

  // O worker só inspeciona bots ativos; oferecer o toggle seria mentira.
  it("não configura bot desativado", async () => {
    render(<BotRecoveryPanel bots={[{ id: "bot-2", bot_username: "paradobot", is_active: false }]} accounts={contas} />);
    fireEvent.click(await screen.findByRole("button", { name: /paradobot/i }));
    expect(await screen.findByText(/só acompanha bots ativos/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /recuperação automática/i })).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
