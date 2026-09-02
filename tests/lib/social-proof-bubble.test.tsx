import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { peerColorIndex, SenderName } from "@/components/telegram/sender-name";
import { MessageMeta } from "@/components/telegram/message-meta";
import { TgAvatar } from "@/components/telegram/avatar";

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
