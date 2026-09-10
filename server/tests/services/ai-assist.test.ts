import { describe, it, expect } from "vitest";
import { buildAssistPrompt, mediaKindsParaIa } from "../../src/services/ai/assist.js";

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


// ─────────────────────────────────────────────────────────────────────────────
// mediaKindsParaIa — o que a IA ouve sobre a mídia da linha.
//
// `media[].type` é dica de RENDERIZAÇÃO e só admite photo/video/audio (o
// MediaItem que a UI lê); documento não cabe nesse union, e o mapeador do
// rascunho grava 'photo' como último recurso. A IA era informada de que um
// PDF é uma imagem, e "Criar texto para a imagem" pedia legenda de uma foto
// que não existe. O `kind` da LINHA sempre soube a verdade.
// ─────────────────────────────────────────────────────────────────────────────

describe("mediaKindsParaIa", () => {
  it("linha 'document' é documento, mesmo com media[].type dizendo 'photo'", () => {
    expect(mediaKindsParaIa("document", ["photo"])).toEqual(["document"]);
  });

  it("foto de verdade continua foto", () => {
    expect(mediaKindsParaIa("photo", ["photo"])).toEqual(["photo"]);
  });

  it("álbum preserva a lista inteira", () => {
    expect(mediaKindsParaIa("album", ["photo", "video"])).toEqual(["photo", "video"]);
  });

  it("mensagem sem mídia nenhuma continua sem mídia", () => {
    expect(mediaKindsParaIa("text", [])).toEqual([]);
  });

  it("kind ausente não inventa nada", () => {
    expect(mediaKindsParaIa(null, ["audio"])).toEqual(["audio"]);
  });

  it("o prompt de legenda de um documento não diz 'foto'", () => {
    const p = buildAssistPrompt("caption", "Contrato", mediaKindsParaIa("document", ["photo"]));
    expect(p.user).toContain("mídia: document");
    expect(p.user).not.toContain("photo");
  });
});
