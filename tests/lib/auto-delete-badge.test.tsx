import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BaseNode } from "@/components/dashboard/flow-builder/nodes/base-node";

describe("BaseNode — badge de auto-delete", () => {
  it("mostra o tempo no card quando o bloco tem auto-delete", () => {
    render(<BaseNode type="text" data={{ text: "oi", auto_delete_seconds: 300 }} />);

    expect(screen.getByText("5min")).toBeInTheDocument();
    expect(screen.getByTitle("Mensagem apagada 5min após o envio")).toBeInTheDocument();
  });

  it("não mostra badge quando o bloco não tem auto-delete", () => {
    render(<BaseNode type="text" data={{ text: "oi" }} />);

    expect(screen.queryByTitle(/apagada/i)).not.toBeInTheDocument();
  });

  it("ignora valor inválido gravado no bloco", () => {
    render(<BaseNode type="text" data={{ text: "oi", auto_delete_seconds: 0 }} />);

    expect(screen.queryByTitle(/apagada/i)).not.toBeInTheDocument();
  });
});
