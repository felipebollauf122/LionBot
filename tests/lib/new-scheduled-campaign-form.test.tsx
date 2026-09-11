import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewScheduledCampaignForm } from "@/components/dashboard/campaigns/new-campaign-form";
import { createEmptyCampaign } from "@/app/dashboard/automations/scheduled/actions";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/dashboard/automations/scheduled/actions", () => ({ createEmptyCampaign: vi.fn() }));

describe("new scheduled campaign screen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opening the screen creates nothing; submission creates a named draft and keeps its owner", async () => {
    vi.mocked(createEmptyCampaign).mockResolvedValue({ ok: true, campaignId: "camp-1" });
    render(<NewScheduledCampaignForm actingTenantId="tenant-1" view="tenant-1" />);
    expect(createEmptyCampaign).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nome da campanha"), { target: { value: "Minha sequência" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar rascunho" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/automations/scheduled/camp-1?view=tenant-1"));
    expect(createEmptyCampaign).toHaveBeenCalledExactlyOnceWith("tenant-1", "Minha sequência");
  });

  it("shows the server error in place and allows a retry", async () => {
    vi.mocked(createEmptyCampaign).mockResolvedValue({ ok: false, error: "Não foi possível criar." });
    render(<NewScheduledCampaignForm actingTenantId="tenant-1" view="mine" />);
    fireEvent.change(screen.getByLabelText("Nome da campanha"), { target: { value: "Minha sequência" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar rascunho" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível criar.");
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar rascunho" })).toBeEnabled());
  });

  it("deduplicates rapid submits while the request is in flight", async () => {
    let complete!: (value: { ok: true; campaignId: string }) => void;
    vi.mocked(createEmptyCampaign).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<NewScheduledCampaignForm actingTenantId="tenant-1" view="mine" />);
    const input = screen.getByLabelText("Nome da campanha");
    fireEvent.change(input, { target: { value: "Minha sequência" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(createEmptyCampaign).toHaveBeenCalledTimes(1);
    complete({ ok: true, campaignId: "camp-1" });
    await waitFor(() => expect(push).toHaveBeenCalled());
  });
});
