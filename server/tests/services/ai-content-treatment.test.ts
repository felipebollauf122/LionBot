import { describe, it, expect } from "vitest";
import {
  applyTreatment,
  buildTreatmentPrompt,
  DELAY_MAX_SECONDS,
  DELAY_MIN_SECONDS,
  type AiTreatment,
  type DraftMessageForAi,
  type TreatmentOptions,
} from "../../src/services/ai/content-treatment.js";

function msg(id: string, over: Partial<DraftMessageForAi> = {}): DraftMessageForAi {
  return { id, position: 1, text: "texto", mediaKinds: [], hasButtons: false, ...over };
}

function linha(over: Record<string, unknown> = {}) {
  return { content_text: "original", content_text_original: null, ...over };
}

function opts(over: Partial<TreatmentOptions> = {}): TreatmentOptions {
  return { clean: true, rewrite: false, smartDelay: false, ...over };
}

function t(over: Partial<AiTreatment> = {}): AiTreatment {
  return { id: "a", action: "keep", text: null, delaySeconds: 900, reason: "", ...over };
}

describe("buildTreatmentPrompt", () => {
  it("inclui as mensagens do lote e marca as de contexto como não-editáveis", () => {
    const p = buildTreatmentPrompt(
      [msg("a", { position: 3 })],
      [msg("ctx", { position: 2, text: "anterior" })],
      opts(),
    );
    expect(p.user).toContain("anterior");
    expect(p.user).toMatch(/contexto/i);
    // A de contexto não pode voltar no resultado: ela já foi tratada.
    expect(p.user).toMatch(/não devolva|nao devolva/i);
  });

  it("as guardas duras estão no system", () => {
    const p = buildTreatmentPrompt([msg("a")], [], opts({ rewrite: true }));
    expect(p.system).toMatch(/preço|preco/i);
    expect(p.system).toMatch(/cupom/i);
    expect(p.system).toMatch(/keep/);
    expect(p.system).toContain(String(DELAY_MIN_SECONDS));
    expect(p.system).toContain(String(DELAY_MAX_SECONDS));
  });

  it("sem a alavanca de reescrita, o system proíbe a ação rewrite", () => {
    const p = buildTreatmentPrompt([msg("a")], [], opts({ rewrite: false }));
    expect(p.system).toMatch(/não use .*rewrite|nao use .*rewrite/i);
  });

  it("informa que a mensagem tem mídia, pra IA poder escrever legenda", () => {
    const p = buildTreatmentPrompt([msg("a", { text: null, mediaKinds: ["photo"] })], [], opts());
    expect(p.user).toContain("photo");
  });
});

describe("applyTreatment", () => {
  it("keep não muda nada e devolve null", () => {
    expect(applyTreatment(linha(), t({ action: "keep" }), opts())).toBeNull();
  });

  it("clean grava o texto novo e preserva o original", () => {
    const patch = applyTreatment(linha(), t({ action: "clean", text: "limpo" }), opts());
    expect(patch).toMatchObject({
      content_text: "limpo",
      content_text_original: "original",
      ai_action: "cleaned",
    });
  });

  it("o original é preservado UMA vez só: um segundo tratamento não o sobrescreve", () => {
    // Reprocessar a campanha não pode apagar o texto raspado.
    const patch = applyTreatment(
      linha({ content_text: "já limpo", content_text_original: "original de verdade" }),
      t({ action: "rewrite", text: "reescrito" }),
      opts({ rewrite: true }),
    );
    expect(patch).toMatchObject({ content_text: "reescrito", ai_action: "rewritten" });
    expect(patch).not.toHaveProperty("content_text_original");
  });

  it("rewrite com a alavanca desligada degrada pra cleaned, mas o texto do modelo não é descartado", () => {
    // Um modelo que devolve rewrite sem autorização não pode parafrasear:
    // a alavanca desligada é uma decisão do dono, não uma sugestão. Mas o
    // texto que ele mandou ainda é aplicado — só o rótulo muda, e o original
    // continua sendo preservado.
    const patch = applyTreatment(linha(), t({ action: "rewrite", text: "parafraseado" }), opts());
    expect(patch).toMatchObject({
      content_text: "parafraseado",
      content_text_original: "original",
      ai_action: "cleaned",
    });
  });

  it("discard marca a linha e guarda o motivo, sem apagar o texto", () => {
    const patch = applyTreatment(
      linha(),
      t({ action: "discard", reason: "anúncio do concorrente" }),
      opts(),
    );
    expect(patch).toMatchObject({
      ai_discarded: true,
      ai_action: "discarded",
      ai_reason: "anúncio do concorrente",
    });
    expect(patch).not.toHaveProperty("content_text");
  });

  it("discard sem motivo é recusado: vira keep", () => {
    expect(applyTreatment(linha(), t({ action: "discard", reason: "" }), opts())).toBeNull();
  });

  it("discard com motivo só de espaços em branco também é recusado", () => {
    // Um "reason" que é só whitespace não é uma explicação legível pro dono.
    expect(applyTreatment(linha(), t({ action: "discard", reason: "   " }), opts())).toBeNull();
  });

  it("discard válido não carrega delay, mesmo com smartDelay ligado", () => {
    // Item descartado não entra na sequência de publicação: o intervalo dele
    // não tem sentido.
    const patch = applyTreatment(
      linha(),
      t({ action: "discard", reason: "spam", delaySeconds: 300 }),
      opts({ smartDelay: true }),
    );
    expect(patch).not.toHaveProperty("delay_seconds");
  });

  it("delay só é aplicado com smartDelay ligado", () => {
    expect(applyTreatment(linha(), t({ delaySeconds: 300 }), opts())).toBeNull();
    expect(
      applyTreatment(linha(), t({ delaySeconds: 300 }), opts({ smartDelay: true })),
    ).toMatchObject({ delay_seconds: 300 });
  });

  it("delay fora da faixa é truncado, nunca recusado", () => {
    const curto = applyTreatment(linha(), t({ delaySeconds: 1 }), opts({ smartDelay: true }));
    expect(curto).toMatchObject({ delay_seconds: DELAY_MIN_SECONDS });

    const longo = applyTreatment(
      linha(),
      t({ delaySeconds: 999_999 }),
      opts({ smartDelay: true }),
    );
    expect(longo).toMatchObject({ delay_seconds: DELAY_MAX_SECONDS });
  });

  it("clean sem texto novo não zera a mensagem", () => {
    // text:null com action clean é o modelo dizendo "não achei o que limpar".
    // Gravar null apagaria o post inteiro.
    expect(applyTreatment(linha(), t({ action: "clean", text: null }), opts())).toBeNull();
  });

  it("rewrite sem texto novo também não zera a mensagem", () => {
    expect(
      applyTreatment(linha(), t({ action: "rewrite", text: null }), opts({ rewrite: true })),
    ).toBeNull();
  });

  it("texto só com espaços conta como vazio, não como substituição", () => {
    expect(
      applyTreatment(linha(), t({ action: "clean", text: "   " }), opts()),
    ).toBeNull();
  });
});
