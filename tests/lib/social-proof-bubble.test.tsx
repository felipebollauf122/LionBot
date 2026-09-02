import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { peerColorIndex, SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { TgAvatar } from "@/components/telegram/avatar";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelHeader } from "@/components/telegram/channel-header";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

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
    senderKind: "member",
    senderName,
    senderAvatarUrl: null,
    kind: "text",
    contentText: `texto ${id}`,
    media: [],
    reactions: [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds,
    displayTime: null,
    viewsCount: 0,
    ...extra,
  };
}

const canalFake: FeedChannel = {
  title: "canal",
  avatarUrl: null,
  subscribersLabel: "10 inscritos",
  isVerified: false,
  ownerName: "Dona",
  ownerAvatarUrl: null,
  ownerUsername: "dona",
  unreadBadge: 0,
};

describe("ChannelFeed", () => {
  it("renderiza todas as mensagens na ordem recebida", () => {
    render(
      <ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Bia", 500)]} channel={canalFake} now={agora} />,
    );
    expect(screen.getByText("texto a")).toBeInTheDocument();
    expect(screen.getByText("texto b")).toBeInTheDocument();
  });

  it("mostra o nome do remetente uma vez só por grupo", () => {
    render(
      <ChannelFeed messages={[fm("a", "Ana", 600), fm("b", "Ana", 580)]} channel={canalFake} now={agora} />,
    );
    expect(screen.getAllByText("Ana")).toHaveLength(1);
  });

  it("repete o nome quando o remetente muda", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600), fm("b", "Bia", 580), fm("c", "Ana", 560)]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getAllByText("Ana")).toHaveLength(2);
  });

  it("insere um separador de dia no topo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600)]} channel={canalFake} now={agora} />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("insere separador novo quando o dia vira", () => {
    // 26h atrás cai em "Ontem"; 10min atrás cai em "Hoje".
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 26 * 3600), fm("b", "Ana", 600)]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("Ontem")).toBeInTheDocument();
    expect(screen.getByText("Hoje")).toBeInTheDocument();
  });

  it("renderiza mídia quando a mensagem tem", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { media: [{ url: "https://exemplo.test/f.jpg", type: "photo" }] })]}
        channel={canalFake}
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
            media: [{ url: "https://exemplo.test/f.jpg", type: "photo" }],
          }),
        ]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-bubble-text")).toBeNull();
  });

  it("feed vazio não quebra", () => {
    const { container } = render(<ChannelFeed messages={[]} channel={canalFake} now={agora} />);
    expect(container.querySelectorAll(".tg-bubble")).toHaveLength(0);
  });
});

describe("ChannelFeed — remetente e conteúdo v2", () => {
  it("mensagem da dona usa a identidade do canal e ganha o selo", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "ignorado", 600, { senderKind: "owner" })]}
        channel={{ ...canalFake, ownerName: "Daniel" }}
        now={agora}
      />,
    );
    expect(screen.getByText("Daniel")).toBeInTheDocument();
    expect(screen.getByText("Dona do canal")).toBeInTheDocument();
  });

  it("mensagem de membro não ganha selo", () => {
    render(<ChannelFeed messages={[fm("a", "Ana", 600)]} channel={canalFake} now={agora} />);
    expect(screen.queryByText("Dona do canal")).not.toBeInTheDocument();
  });

  it("renderiza a grade quando há duas ou mais mídias", () => {
    const { container } = render(
      <ChannelFeed
        messages={[
          fm("a", "Ana", 600, {
            kind: "album",
            media: [
              { url: "1.jpg", type: "photo" },
              { url: "2.jpg", type: "photo" },
            ],
          }),
        ]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-album")).toBeTruthy();
  });

  it("renderiza a bolha de áudio", () => {
    const { container } = render(
      <ChannelFeed
        messages={[
          fm("a", "Ana", 600, {
            kind: "audio",
            contentText: null,
            media: [{ url: "a.mp3", type: "audio", durationSeconds: 30 }],
          }),
        ]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(container.querySelector(".tg-audio")).toBeTruthy();
    expect(screen.getByText("0:30")).toBeInTheDocument();
  });

  it("renderiza as reações", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { reactions: [{ emoji: "❤️", count: 24 }] })]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("renderiza a citação da resposta", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { replyToSender: "Bia", replyToText: "original" })]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("original")).toBeInTheDocument();
  });

  it("displayTime sobrepõe o horário calculado do offset", () => {
    render(
      <ChannelFeed
        messages={[fm("a", "Ana", 600, { displayTime: "02:44" })]}
        channel={canalFake}
        now={agora}
      />,
    );
    expect(screen.getByText("02:44")).toBeInTheDocument();
    expect(screen.queryByText("14:50")).not.toBeInTheDocument();
  });
});

describe("ChannelHeader", () => {
  it("mostra o badge de não lidas quando maior que zero", () => {
    render(<ChannelHeader channel={{ ...canalFake, unreadBadge: 243 }} />);
    expect(screen.getByText("243")).toBeInTheDocument();
  });

  it("esconde o badge quando é zero", () => {
    render(<ChannelHeader channel={{ ...canalFake, unreadBadge: 0 }} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
