import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";
import type { ComposerMessageRow } from "@/lib/composer/types";
import type { ChannelInput } from "@/lib/social-proof/types";

// FeedPreview importa components/telegram/fonts.ts, que chama next/font/google
// em tempo de módulo. Isso só funciona dentro do pipeline de build do Next —
// sob Vitest a chamada real explode com "Inter is not a function". Nenhum
// teste antes deste renderizava FeedPreview, então ninguém tinha esbarrado
// nisso; mocka-se aqui, no arquivo de teste, sem tocar em setup global.
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "mock-tgc-font-inter" }),
  Roboto: () => ({ variable: "mock-tgc-font-roboto" }),
}));

const canal: ChannelInput = {
  title: "Canal de teste",
  avatar_url: null,
  subscribers_label: "1 mil inscritos",
  is_verified: false,
  is_active: true,
  owner_name: "Dona",
  owner_avatar_url: null,
  owner_username: "dona",
  unread_badge: 0,
};

/** Uma linha vinda de mtproto_scheduled_messages: sem os campos de Prova Social. */
const linhaDeCampanha: ComposerMessageRow = {
  id: "m1",
  kind: "text",
  content_text: "Post agendado",
  media: [],
  reply_to_id: null,
};

describe("ComposerMessageRow sem os campos de Prova Social", () => {
  it("renderiza a bolha sem quebrar", () => {
    render(
      <FeedPreview
        channel={canal}
        messages={[linhaDeCampanha]}
        draft={null}
        pinnedText=""
      />,
    );
    expect(screen.getByText("Post agendado")).toBeInTheDocument();
  });

  it("não mostra contador de visualizações nem reações", () => {
    const { container } = render(
      <FeedPreview
        channel={canal}
        messages={[linhaDeCampanha]}
        draft={null}
        pinnedText=""
      />,
    );
    expect(container.querySelector(".tg-reactions")).toBeNull();
    // views_count ausente vira 0, e 0 não desenha o contador.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("uma linha de Prova Social completa continua renderizando igual", () => {
    render(
      <FeedPreview
        channel={canal}
        messages={[
          {
            ...linhaDeCampanha,
            id: "m2",
            content_text: "Post de prova social",
            sender_kind: "member",
            sender_name: "Cliente",
            sender_avatar_url: null,
            reactions: [{ emoji: "🔥", count: 3 }],
            offset_seconds: 600,
            views_count: 120,
            display_time: null,
          },
        ]}
        draft={null}
        pinnedText=""
      />,
    );
    expect(screen.getByText("Post de prova social")).toBeInTheDocument();
    expect(screen.getByText("Cliente")).toBeInTheDocument();
  });

  it("linha 'document' vira chip de arquivo, nunca imagem quebrada", () => {
    // Achado do Plano 1: StagedMedia herda o union de MediaItem, que não tem
    // "document", então media[0].type vem "photo" mesmo sendo um PDF. Sem
    // tratamento a prévia desenharia isso como <img> quebrado.
    const linhaDocumento: ComposerMessageRow = {
      id: "d1",
      kind: "document",
      content_text: null,
      media: [{ url: "https://exemplo.com/contrato.pdf", type: "photo" }],
      reply_to_id: null,
      file_name: "contrato.pdf",
    };

    const { container } = render(
      <FeedPreview
        channel={canal}
        messages={[linhaDocumento]}
        draft={null}
        pinnedText=""
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/contrato\.pdf/)).toBeInTheDocument();
  });
});
