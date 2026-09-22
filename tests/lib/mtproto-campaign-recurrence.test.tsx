import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MtprotoCampaignForm } from "@/components/dashboard/mtproto-campaign-form";
import { createCampaign } from "@/app/dashboard/automations/actions";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/dashboard/automations/actions", () => ({
  createCampaign: vi.fn(),
  launchCampaign: vi.fn(),
  listActiveAccounts: vi.fn(async () => []),
  listAccountDialogs: vi.fn(async () => []),
}));

describe("recorrência do disparo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createCampaign).mockResolvedValue({ ok: true, campaignId: "campaign-1" });
  });

  it("aceita 0 horas, 0 minutos e envia um intervalo somente em segundos", async () => {
    render(<MtprotoCampaignForm />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Disparo global/ }));
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Segundos"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      recurrenceSeconds: 1,
    })));
  });

  it("exige ao menos um segundo quando a repetição está ativa", () => {
    render(<MtprotoCampaignForm />);

    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Segundos"), { target: { value: "0" } });

    expect(screen.getByText(/informe ao menos 1s/)).toBeInTheDocument();
  });
});
