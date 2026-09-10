import { describe, it, expect } from "vitest";
import { buildAssistPrompt } from "../../src/services/ai/assist.js";

describe("buildAssistPrompt", () => {
  it("rewrite pede paráfrase preservando fatos e oferta", () => {
    const p = buildAssistPrompt("rewrite", "compre por R$ 97", []);
    expect(p.system).toMatch(/reescrev/i);
    expect(p.system).toMatch(/preço|preco/i);
    expect(p.user).toContain("R$ 97");
  });

  it("caption pede legenda a partir da mídia quando não há texto", () => {
    const p = buildAssistPrompt("caption", null, ["photo"]);
    expect(p.system).toMatch(/legenda/i);
    expect(p.user).toContain("photo");
  });

  it("summarize pede resumo curto", () => {
    const p = buildAssistPrompt("summarize", "um texto bem longo", []);
    expect(p.system).toMatch(/resum/i);
  });

  it("as três ações compartilham as mesmas guardas de preço e link", () => {
    for (const acao of ["rewrite", "caption", "summarize"] as const) {
      const p = buildAssistPrompt(acao, "texto", []);
      expect(p.system).toMatch(/preço|preco/i);
      expect(p.system).toMatch(/nunca invente/i);
    }
  });
});
