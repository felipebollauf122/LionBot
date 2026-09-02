import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { peerColorIndex, SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { TgAvatar } from "@/components/telegram/avatar";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import type { FeedMessage } from "@/lib/social-proof/types";

describe("peerColorIndex", () => {
  it("é determinístico: o mesmo nome sempre dá a mesma cor", () => {
    expect(peerColorIndex("Ana Paula")).toBe(peerColorIndex("Ana Paula"));
  });

  it("fica dentro das 7 cores de peer do Telegram", () => {
    for (const nome of ["Ana", "Bia", "Carlos", "Dedé", "Ellen", "Fábio", "Gu", "H", ""]) {
      const i = peerColorIndex(nome);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });

  it("ignora espaço em volta, igual ao agrupamento", () => {
    expect(peerColorIndex(" Ana ")).toBe(peerColorIndex("Ana"));
  });

  it("nomes diferentes não caem todos na mesma cor", () => {
    const cores = new Set(
      ["Ana", "Bia", "Carlos", "Daniel", "Elis", "Fernanda", "Gustavo", "Helena"].map(peerColorIndex),
    );
    expect(cores.size).toBeGreaterThan(1);
  });
});

describe("SenderName", () => {
  it("mostra o nome", () => {
    render(<SenderName name="Ana Paula" />);
    expect(screen.getByText("Ana Paula")).toBeInTheDocument();
  });
});

describe("MessageMeta", () => {
  it("mostra hora e views formatadas", () => {
    render(<MessageMeta at={new Date("2026-09-01T14:45:00-03:00")} views={15300} />);
    expect(screen.getByText("14:45")).toBeInTheDocument();
    expect(screen.getByText("15,3K")).toBeInTheDocument();
  });

  it("omite o contador quando não há views", () => {
    render(<MessageMeta at={new Date("2026-09-01T14:45:00-03:00")} views={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("TgAvatar", () => {
  it("usa a imagem quando há url", () => {
    render(<TgAvatar name="Ana" url="https://exemplo.test/a.jpg" visible />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://exemplo.test/a.jpg");
  });

  it("cai na inicial quando não há url", () => {
    render(<TgAvatar name="ana paula" url={null} visible />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("ocupa o espaço mesmo invisível, pra não desalinhar o grupo", () => {
    const { container } = render(<TgAvatar name="Ana" url={null} visible={false} />);
    // O slot continua no DOM: sem ele, as mensagens do meio do grupo
    // encostariam na borda e o bloco ficaria torto.
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });
});

const agora = new Date("2026-09-01T15:00:00-03:00");

function fm(id: string, senderName: string, offsetSeconds: number, extra: Partial<FeedMessage> = {}): FeedMessage {
  return {
    id,
    senderName,
    senderAvatarUrl: null,
    contentText: `texto ${id}`,
    mediaUrl: null,
    mediaType: null,
    offsetSeconds,
    viewsCount: 0,
    ...extra,
  };
}

describe("ChannelFeed", () => {
  it("renderiza todas as mensagens na ordem recebida", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Bia", 500)]} now={agora} />);
    expect(screen.getByText("texto a")).toBeInTheDocument();
    expect(screen.getByText("texto b")).toBeInTheDocument();
  });

  it("mostra o nome do remetente uma vez só por grupo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Ana", 580)]} now={agora} />);
    expect(screen.getAllByText("Ana")).toHaveLength(1);
  });

  it("repete o nome quando o remetente muda", () => {
    render(
      <ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Bia", 580), fm("c", "Ana", 560)]} now={agora} />,
    );
    expect(screen.getAllByText("Ana")).toHaveLength(2);
  });

  it("insere um separador de dia no topo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600)]} now={agora} />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("insere separador novo quando o dia vira", () => {
    // 26h atrás cai em "Ontem"; 10min atrás cai em "Hoje".
    render(<ChannelFeed messages={[fm("a", "Ana", 26 * 3600), fm("b", "Ana", 600)]} now={agora} />);
    expect(screen.getByText("Ontem")).toBeInTheDocument();
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("renderiza mídia quando a mensagem tem", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { mediaUrl: "https://exemplo.test/f.jpg", mediaType: "image" })]}
        now={agora}
      />,
    );
    expect(document.querySelector('img[src="https://exemplo.test/f.jpg"]')).toBeTruthy();
  });

  it("mensagem só de mídia não renderiza parágrafo de texto vazio", () => {
    const { container } = render(
      <ChannelFeed
        messages={[
          fm("a", "Ana", 600, {
            contentText: null,
            mediaUrl: "https://exemplo.test/f.jpg",
            mediaType: "image",
          }),
        ]}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-bubble-text")).toBeNull();
  });

  it("feed vazio não quebra", () => {
    const { container } = render(<ChannelFeed messages={[]} now={agora} />);
    expect(container.querySelectorAll(".tg-bubble")).toHaveLength(0);
  });
});
