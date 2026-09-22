import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MtprotoCampaignDetail } from "@/components/dashboard/mtproto-campaign-detail";
import { createClient } from "@/lib/supabase/client";
import { pauseCampaign, updateCampaign, launchCampaign } from "@/app/dashboard/automations/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("view=naves") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/app/dashboard/automations/actions", () => ({ launchCampaign: vi.fn(), pauseCampaign: vi.fn(), deleteCampaign: vi.fn(), updateCampaign: vi.fn() }));
const campaign = { id: "c1", name: "Naves", message_text: "Mensagem", status: "running", total_targets: 630, sent_count: 22, failed_count: 58, skipped_count: 370, delay_min_seconds: 1, delay_max_seconds: 1, started_at: null, completed_at: null, is_processing: true, processing_started_at: "2026-09-21T18:16:32Z", recurrence_seconds: 5 };
const targets = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), target_identifier: `destino-${String(i).padStart(4, "0")}`, target_type: "username", status: i < 22 ? "sent" : i < 80 ? "failed" : i < 450 ? "skipped" : "pending", error_message: i >= 22 && i < 80 ? "PEER_FLOOD" : i >= 80 && i < 450 ? "CHAT_WRITE_FORBIDDEN" : null, sent_at: i < 22 ? "2026-09-21T18:32:11Z" : null, retry_after: null }));

function database(fail = false, row = campaign) {
  vi.mocked(createClient).mockReturnValue({ from: (table: string) => {
    const q = { select: () => q, eq: () => q, order: () => q,
      single: async () => ({ data: row, error: null }),
      range: async (from: number, to: number) => ({ data: fail ? null : targets.slice(from, to + 1), error: fail ? { message: "offline" } : null }),
    }; return table ? q : q;
  } } as unknown as ReturnType<typeof createClient>);
}

describe("acompanhamento do disparo", () => {
  beforeEach(() => { vi.clearAllMocks(); database(); });
  it("permite enviar agora mesmo com horário antigo de retomada", async () => {
    const scheduled = { ...campaign, status: "scheduled", next_run_at: "2026-09-22T23:01:56-03:00" };
    database(false, scheduled);
    vi.mocked(launchCampaign).mockResolvedValue({ ok: true });
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={scheduled} />);
    await screen.findByText("Destinos (1.000)");
    expect(screen.queryByText(/23:01:56/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nova tentativa no intervalo configurado: 5s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    await waitFor(() => expect(launchCampaign).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Enviar agora" })).not.toBeInTheDocument());
  });
  it("edita mensagem e intervalo durante a execução sem pausar", async () => {
    vi.mocked(updateCampaign).mockResolvedValue({ ok: true });
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={campaign} />);
    await screen.findByText("Destinos (1.000)");
    fireEvent.click(screen.getByRole("button", { name: "Editar disparo" }));
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Nova mensagem" } });
    fireEvent.change(screen.getByLabelText("Repetir a cada (segundos)"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith("c1", expect.objectContaining({ message: "Nova mensagem", recurrenceSeconds: 3 })));
    expect(await screen.findByText(/Alterações salvas/)).toBeInTheDocument();
    expect(pauseCampaign).not.toHaveBeenCalled();
  });
  it("mantém o formulário e o texto quando salvar falha", async () => {
    vi.mocked(updateCampaign).mockResolvedValue({ ok: false, error: "Falha ao salvar" });
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={campaign} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar disparo" }));
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Não perder" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao salvar");
    expect(screen.getByLabelText("Mensagem")).toHaveValue("Não perder");
  });
  it("mostra todos os destinos e distingue progresso de mensagens entregues", async () => {
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={campaign} />);
    expect(await screen.findByText("Destinos (1.000)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "450"));
    expect(screen.getByText(/Total da lista: 1.000/)).toHaveTextContent("Aptos: 630");
    expect(screen.getByText("Recuperando envio")).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 20/)).toBeInTheDocument();
  });
  it("busca e filtros encontram destinos além da primeira página", async () => {
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={campaign} />);
    await screen.findByText("Destinos (1.000)");
    await waitFor(() => expect(screen.getByRole("button", { name: /Aguardando 550/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Aguardando 550/ }));
    fireEvent.change(screen.getByLabelText("Buscar destino ou motivo"), { target: { value: "destino-0999" } });
    expect(screen.getByText("destino-0999")).toBeInTheDocument();
    expect(screen.getByText(/1 resultados/)).toBeInTheDocument();
  });
  it("falha de leitura não se disfarça de lista vazia ou progresso zerado", async () => {
    database(true);
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={campaign} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Não foi possível atualizar");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "450");
  });
  it("erro ao pausar fica visível e permite tentar novamente", async () => {
    vi.mocked(pauseCampaign).mockRejectedValue(new Error("offline"));
    render(<MtprotoCampaignDetail campaignId="c1" initialCampaign={campaign} />);
    fireEvent.click(screen.getByRole("button", { name: "Pausar envio" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível pausar");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pausar envio" })).toBeEnabled());
  });
});
