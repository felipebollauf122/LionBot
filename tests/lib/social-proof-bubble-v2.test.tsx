import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactionsRow } from "@/components/telegram/reactions-row";
import { AlbumGrid } from "@/components/telegram/album-grid";
import { AudioBubble } from "@/components/telegram/audio-bubble";
import { ReplyPreview } from "@/components/telegram/reply-preview";
import { PinnedBar } from "@/components/telegram/pinned-bar";

describe("ReactionsRow", () => {
  it("mostra emoji e contador", () => {
    render(<ReactionsRow reactions={[{ emoji: "❤️", count: 24 }]} />);
    expect(screen.getByText("❤️")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("não renderiza nada quando a lista está vazia", () => {
    const { container } = render(<ReactionsRow reactions={[]} />);
    expect(container.querySelector(".tg-reactions")).toBeNull();
  });

  it("omite reação com contador zero", () => {
    // Reação sem ninguém é ruído visual e denuncia que os números são inventados.
    const { container } = render(<ReactionsRow reactions={[{ emoji: "🔥", count: 0 }]} />);
    expect(container.querySelector(".tg-reactions")).toBeNull();
  });
});

describe("AlbumGrid", () => {
  it("renderiza uma imagem por item", () => {
    const { container } = render(
      <AlbumGrid media={[{ url: "a.jpg", type: "photo" }, { url: "b.jpg", type: "photo" }]} />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("usa video para item de vídeo", () => {
    const { container } = render(
      <AlbumGrid media={[{ url: "a.jpg", type: "photo" }, { url: "b.mp4", type: "video" }]} />,
    );
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("mostra o excedente como +N a partir do quinto item", () => {
    const media = Array.from({ length: 6 }, (_, i) => ({ url: `${i}.jpg`, type: "photo" as const }));
    render(<AlbumGrid media={media} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("não mostra +N com exatamente quatro itens", () => {
    const media = Array.from({ length: 4 }, (_, i) => ({ url: `${i}.jpg`, type: "photo" as const }));
    const { container } = render(<AlbumGrid media={media} />);
    expect(container.textContent).not.toContain("+");
  });
});

describe("AudioBubble", () => {
  it("mostra a duração formatada", () => {
    render(<AudioBubble item={{ url: "a.mp3", type: "audio", durationSeconds: 72 }} seed="m1" />);
    expect(screen.getByText("1:12")).toBeInTheDocument();
  });

  it("sem duração mostra 0:00", () => {
    render(<AudioBubble item={{ url: "a.mp3", type: "audio" }} seed="m1" />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("a onda é determinística: a mesma seed dá as mesmas barras", () => {
    const a = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="igual" />);
    const alturasA = [...a.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );
    a.unmount();

    const b = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="igual" />);
    const alturasB = [...b.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );

    expect(alturasA).toEqual(alturasB);
    expect(alturasA.length).toBeGreaterThan(0);
  });

  it("seeds diferentes produzem ondas diferentes", () => {
    const a = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="um" />);
    const alturasA = [...a.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );
    a.unmount();

    const b = render(<AudioBubble item={{ url: "x", type: "audio" }} seed="dois" />);
    const alturasB = [...b.container.querySelectorAll(".tg-audio-bar")].map(
      (b) => (b as HTMLElement).style.height,
    );

    expect(alturasA).not.toEqual(alturasB);
  });
});

describe("ReplyPreview", () => {
  it("mostra remetente e texto citados", () => {
    render(<ReplyPreview sender="Ana" text="mensagem original" />);
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("mensagem original")).toBeInTheDocument();
  });
});

describe("PinnedBar", () => {
  it("mostra o rótulo e o texto fixado", () => {
    render(<PinnedBar text="Bem-vindas ao canal VIP" />);
    expect(screen.getByText("Mensagem fixada")).toBeInTheDocument();
    expect(screen.getByText("Bem-vindas ao canal VIP")).toBeInTheDocument();
  });

  it("não renderiza nada com texto vazio", () => {
    const { container } = render(<PinnedBar text="   " />);
    expect(container.querySelector(".tg-pinned")).toBeNull();
  });
});
