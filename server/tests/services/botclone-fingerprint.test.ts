import { describe, it, expect } from "vitest";
import { computeStateFingerprint, type FingerprintInput } from "../../src/services/mtproto/bot-clone/fingerprint.js";

function turn(over: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    messages: [{ text: "Escolha uma opção", mediaKind: "none", buttonLabels: ["Ver mais", "Voltar"] }],
    ...over,
  };
}

describe("computeStateFingerprint", () => {
  it("mesmo texto+botões → mesma fingerprint", () => {
    expect(computeStateFingerprint(turn())).toBe(computeStateFingerprint(turn()));
  });

  it("botões diferentes → fingerprint diferente", () => {
    const a = turn();
    const b = turn({ messages: [{ text: "Escolha uma opção", mediaKind: "none", buttonLabels: ["Outra opção"] }] });
    expect(computeStateFingerprint(a)).not.toBe(computeStateFingerprint(b));
  });

  it("mediaKind diferente → fingerprint diferente", () => {
    const a = turn();
    const b = turn({ messages: [{ text: "Escolha uma opção", mediaKind: "photo", buttonLabels: ["Ver mais", "Voltar"] }] });
    expect(computeStateFingerprint(a)).not.toBe(computeStateFingerprint(b));
  });

  it("relógio/contador no texto não muda a fingerprint entre duas capturas (achado de volatilidade)", () => {
    const a = turn({ messages: [{ text: "Oferta expira em 04:59", mediaKind: "none", buttonLabels: [] }] });
    const b = turn({ messages: [{ text: "Oferta expira em 02:13", mediaKind: "none", buttonLabels: [] }] });
    expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
  });

  it("contador regressivo em texto (30 segundos restantes) não muda a fingerprint", () => {
    const a = turn({ messages: [{ text: "30 segundos restantes!", mediaKind: "none", buttonLabels: [] }] });
    const b = turn({ messages: [{ text: "12 segundos restantes!", mediaKind: "none", buttonLabels: [] }] });
    expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
  });

  it("número de pedido (#12345) no texto não muda a fingerprint", () => {
    const a = turn({ messages: [{ text: "Seu pedido #48291 está pronto", mediaKind: "none", buttonLabels: [] }] });
    const b = turn({ messages: [{ text: "Seu pedido #99123 está pronto", mediaKind: "none", buttonLabels: [] }] });
    expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
  });

  it("rótulo de botão com token por visita (achado #3): mesma fingerprint entre visitas", () => {
    const a = turn({ messages: [{ text: "Confirme", mediaKind: "none", buttonLabels: ["Confirmar #48291"] }] });
    const b = turn({ messages: [{ text: "Confirme", mediaKind: "none", buttonLabels: ["Confirmar #99123"] }] });
    expect(computeStateFingerprint(a)).toBe(computeStateFingerprint(b));
  });

  it("dois preços diferentes com contexto de moeda NÃO colapsam (achado #11 — sem escovar dígito sem contexto)", () => {
    const a = turn({ messages: [{ text: "Plano mensal: R$990/mês", mediaKind: "none", buttonLabels: [] }] });
    const b = turn({ messages: [{ text: "Plano anual: R$1990/ano", mediaKind: "none", buttonLabels: [] }] });
    expect(computeStateFingerprint(a)).not.toBe(computeStateFingerprint(b));
  });

  it("mensagem extra no burst muda a fingerprint", () => {
    const a = turn();
    const b = turn({
      messages: [
        { text: "Escolha uma opção", mediaKind: "none", buttonLabels: ["Ver mais", "Voltar"] },
        { text: "Mensagem extra", mediaKind: "none", buttonLabels: [] },
      ],
    });
    expect(computeStateFingerprint(a)).not.toBe(computeStateFingerprint(b));
  });
});
