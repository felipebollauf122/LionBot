import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutoDeleteConfig } from "@/components/dashboard/flow-builder/config-forms/auto-delete-config";

/** Espelha o editor real: o painel devolve `data` alterado no próximo render. */
function ControlledAutoDelete({ initial }: { initial: Record<string, unknown> }) {
  const [data, setData] = useState(initial);
  return <AutoDeleteConfig data={data} onChange={setData} />;
}

describe("AutoDeleteConfig", () => {
  it("começa desligado e sem campos de tempo quando o bloco não tem config", () => {
    render(<AutoDeleteConfig data={{ text: "oi" }} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /desativado/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Duração")).not.toBeInTheDocument();
  });

  it("ao ligar, grava o padrão de 30 segundos preservando o resto do bloco", () => {
    const onChange = vi.fn();
    render(<AutoDeleteConfig data={{ text: "oi" }} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /desativado/i }));

    expect(onChange).toHaveBeenCalledWith({
      text: "oi",
      auto_delete_seconds: 30,
      auto_delete_unit: "seconds",
    });
  });

  it("mostra a duração na unidade que o usuário escolheu", () => {
    render(<AutoDeleteConfig data={{ auto_delete_seconds: 300, auto_delete_unit: "minutes" }} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Duração")).toHaveValue(5);
    expect(screen.getByLabelText("Unidade")).toHaveValue("minutes");
  });

  it("recalcula os segundos ao trocar a unidade, mantendo a duração digitada", () => {
    const onChange = vi.fn();
    render(<AutoDeleteConfig data={{ auto_delete_seconds: 5, auto_delete_unit: "seconds" }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "minutes" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ auto_delete_seconds: 300, auto_delete_unit: "minutes" }),
    );
  });

  it("ao desligar, limpa os campos pro fluxo voltar a mandar no tempo", () => {
    const onChange = vi.fn();
    render(<AutoDeleteConfig data={{ text: "oi", auto_delete_seconds: 300, auto_delete_unit: "minutes" }} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /ativado/i }));

    expect(onChange).toHaveBeenCalledWith({ text: "oi" });
  });

  it("não promete imprecisão: a deleção é agendada com o tempo exato", () => {
    render(<AutoDeleteConfig data={{ auto_delete_seconds: 10, auto_delete_unit: "seconds" }} onChange={vi.fn()} />);

    expect(screen.queryByText(/precisão/i)).not.toBeInTheDocument();
    expect(screen.getByText(/10s/)).toBeInTheDocument();
  });

  it("não fecha a seção quando o usuário apaga o campo de duração pra redigitar", () => {
    render(<ControlledAutoDelete initial={{ auto_delete_seconds: 30, auto_delete_unit: "seconds" }} />);

    fireEvent.change(screen.getByLabelText("Duração"), { target: { value: "" } });

    // Campo continua na tela (o toggle não voltou pra "Desativado" sozinho).
    expect(screen.getByLabelText("Duração")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Duração"), { target: { value: "45" } });
    expect(screen.getByLabelText("Duração")).toHaveValue(45);
  });
});
