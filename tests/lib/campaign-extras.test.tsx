import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CampaignExtras } from "@/components/dashboard/campaigns/campaign-extras";
import type { MessageInput } from "@/lib/social-proof/types";

// CampaignExtras importa revertAiText/toggleDiscarded direto do módulo (não
// via props) — mocka-se pra render() não tentar chamar Supabase de verdade.
vi.mock("@/app/dashboard/automations/scheduled/actions", () => ({
  revertAiText: vi.fn(async () => ({ ok: true })),
  toggleDiscarded: vi.fn(async () => ({ ok: true })),
}));

function msg(over: Partial<MessageInput> = {}): MessageInput {
  return {
    id: "msg-1",
    sender_kind: "owner",
    sender_name: "",
    sender_avatar_url: null,
    kind: "text",
    content_text: "post original",
    media: [],
    reactions: [],
    reply_to_id: null,
    display_time: null,
    offset_seconds: 0,
    views_count: 0,
    ...over,
  };
}

describe("CampaignExtras — botões de assistente", () => {
  it("sem onAssist, nenhum botão de assistente aparece", () => {
    render(<CampaignExtras value={msg()} onChange={vi.fn()} campaignId="camp-1" />);
    expect(screen.queryByText("Reescrever este post")).not.toBeInTheDocument();
  });

  it("clicar 'Reescrever este post' chama onAssist com o id e a ação, e atualiza o texto ao voltar", async () => {
    const onAssist = vi.fn(async () => ({ ok: true as const, text: "texto reescrito" }));
    const onChange = vi.fn();

    render(
      <CampaignExtras
        value={msg()}
        onChange={onChange}
        campaignId="camp-1"
        onAssist={onAssist}
      />,
    );

    fireEvent.click(screen.getByText("Reescrever este post"));

    await waitFor(() => expect(onAssist).toHaveBeenCalledWith("msg-1", "rewrite"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          content_text: "texto reescrito",
          content_text_original: "post original",
        }),
      ),
    );
  });

  it("erro do assistente aparece na tela, sem quebrar o texto atual", async () => {
    const onAssist = vi.fn(async () => ({ ok: false as const, error: "O assistente falhou." }));
    render(
      <CampaignExtras value={msg()} onChange={vi.fn()} campaignId="camp-1" onAssist={onAssist} />,
    );

    fireEvent.click(screen.getByText("Resumir"));

    expect(await screen.findByText("O assistente falhou.")).toBeInTheDocument();
  });

  it("'Criar texto para a imagem' fica desabilitado sem mídia, com o motivo no title", () => {
    render(
      <CampaignExtras
        value={msg({ media: [] })}
        onChange={vi.fn()}
        campaignId="camp-1"
        onAssist={vi.fn()}
      />,
    );

    const botao = screen.getByText("Criar texto para a imagem");
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", "Adicione uma mídia antes de gerar a legenda.");
  });

  it("'Criar texto para a imagem' fica habilitado quando a mensagem tem mídia", () => {
    render(
      <CampaignExtras
        value={msg({ media: [{ url: "https://x/img.jpg", type: "photo" }] })}
        onChange={vi.fn()}
        campaignId="camp-1"
        onAssist={vi.fn()}
      />,
    );

    expect(screen.getByText("Criar texto para a imagem")).not.toBeDisabled();
  });
});

describe("CampaignExtras — detalhe técnico de um envio que falhou (fix C)", () => {
  it("mensagem falhou: mostra o erro cru, claramente rotulado, fora do hover", () => {
    render(
      <CampaignExtras
        value={msg()}
        onChange={vi.fn()}
        campaignId="camp-1"
        status="failed"
        errorMessage="download da mídia falhou (404): https://cdn.example/x.jpg"
      />,
    );

    expect(screen.getByText("Detalhe técnico do envio")).toBeInTheDocument();
    const bruto = screen.getByText(
      "download da mídia falhou (404): https://cdn.example/x.jpg",
    );
    expect(bruto).toBeInTheDocument();
    // Não é um `title` (hover) — é texto normal na tela.
    expect(bruto.closest("[title]")).toBeNull();
  });

  it("sem falha, ou falha sem error_message, nenhum detalhe técnico aparece", () => {
    const { rerender } = render(
      <CampaignExtras value={msg()} onChange={vi.fn()} campaignId="camp-1" status="pending" />,
    );
    expect(screen.queryByText("Detalhe técnico do envio")).not.toBeInTheDocument();

    rerender(
      <CampaignExtras value={msg()} onChange={vi.fn()} campaignId="camp-1" status="failed" />,
    );
    expect(screen.queryByText("Detalhe técnico do envio")).not.toBeInTheDocument();
  });
});
