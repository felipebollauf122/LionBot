import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DestinationCard } from "@/components/dashboard/campaigns/destination-card";
import {
  ensureBotAccessOnDestination,
  listDestinationDialogs,
} from "@/app/dashboard/automations/scheduled/actions";

vi.mock("@/app/dashboard/automations/scheduled/actions", () => ({
  listDestinationDialogs: vi.fn(async () => []),
  setCampaignDestination: vi.fn(async () => ({ ok: true })),
  ensureBotAccessOnDestination: vi.fn(async () => ({ ok: true })),
}));

const mockEnsureBotAccess = vi.mocked(ensureBotAccessOnDestination);
const mockListDialogs = vi.mocked(listDestinationDialogs);

beforeEach(() => {
  mockEnsureBotAccess.mockClear();
  mockListDialogs.mockClear();
});

describe("DestinationCard — preparar o bot no destino", () => {
  it("sem destino escolhido, o botão de preparar o bot nem aparece", () => {
    render(
      <DestinationCard campaignId="camp-1" currentDialogId={null} currentTitle={null} />,
    );
    expect(screen.queryByRole("button", { name: /preparar o bot/i })).not.toBeInTheDocument();
  });

  it("sucesso mostra o selo 'Bot pronto para publicar' e chama a action com o campaignId certo", async () => {
    render(
      <DestinationCard
        campaignId="camp-1"
        currentDialogId="dialog-1"
        currentTitle="Canal de destino"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /preparar o bot/i }));

    await waitFor(() => {
      expect(screen.getByText("Bot pronto para publicar")).toBeInTheDocument();
    });
    expect(mockEnsureBotAccess).toHaveBeenCalledWith("camp-1");
    // Sem erro nenhum na tela.
    expect(screen.queryByText(/BotFather/i)).not.toBeInTheDocument();
  });

  it("recusa acionável (ex.: privacidade de grupo) aparece por inteiro na tela, sem selo de sucesso", async () => {
    mockEnsureBotAccess.mockResolvedValueOnce({
      ok: false,
      error:
        "O bot está com a privacidade de grupo ligada. Abra o BotFather, vá em Bot Settings › Group Privacy e desligue, depois tente de novo.",
    });

    render(
      <DestinationCard
        campaignId="camp-1"
        currentDialogId="dialog-1"
        currentTitle="Canal de destino"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /preparar o bot/i }));

    await waitFor(() => {
      expect(screen.getByText(/BotFather/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Bot pronto para publicar")).not.toBeInTheDocument();
  });
});
