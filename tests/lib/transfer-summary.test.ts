import { describe, it, expect } from "vitest";
import { summarizeMoved } from "@/lib/transfer-summary";

describe("summarizeMoved", () => {
  it("traduz e ordena da maior contagem pra menor", () => {
    expect(summarizeMoved({ flows: 3, leads: 232, transactions: 14 })).toBe(
      "232 leads, 14 vendas, 3 fluxos",
    );
  });

  it("omite tabela zerada — bot sem venda não diz '0 vendas'", () => {
    expect(summarizeMoved({ leads: 5, transactions: 0, media_assets: 0 })).toBe("5 leads");
  });

  it("bot recém-criado, sem nada além dele mesmo", () => {
    expect(summarizeMoved({})).toBe("nenhum registro além do próprio bot");
    expect(summarizeMoved({ leads: 0, flows: 0 })).toBe("nenhum registro além do próprio bot");
  });

  it("tabela nova (migration futura) aparece com o nome cru, não some", () => {
    expect(summarizeMoved({ tabela_nova: 2 })).toBe("2 tabela_nova");
  });

  it("ignora valor não-numérico vindo do jsonb sem quebrar a frase", () => {
    const moved = { leads: 4, lixo: null } as unknown as Record<string, number>;
    expect(summarizeMoved(moved)).toBe("4 leads");
  });
});
