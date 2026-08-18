import { describe, it, expect } from "vitest";
import { collectPriceCandidates } from "../../src/services/mtproto/bot-clone/price-candidates.js";
import type { CapturedNodeForFlow } from "../../src/services/mtproto/bot-clone/transcript-to-flow.js";
import type { PersistedButton, PersistedMessage } from "../../src/services/mtproto/bot-clone/explorer.js";

function msg(over: Partial<PersistedMessage> = {}): PersistedMessage {
  return { seq: 0, rawMsgId: 1, text: "oi", entities: [], mediaKind: "none", mediaPublicUrl: null, buttons: [], ...over };
}

function btn(over: Partial<PersistedButton> = {}): PersistedButton {
  return {
    id: "b0_0",
    kind: "callback",
    label: "Vip Mensal por R$ 15.93",
    url: null,
    data: null,
    skip: true,
    skipReason: "payment_keyword_match",
    paymentDomainMatch: false,
    ...over,
  };
}

function node(over: Partial<CapturedNodeForFlow> = {}): CapturedNodeForFlow {
  return { id: "n1", parentNodeId: null, triggeredByButtonId: null, status: "explored", duplicateOfNodeId: null, messages: [], ...over };
}

describe("collectPriceCandidates", () => {
  it("mesmo rótulo repetido em nós do fluxo principal e em bursts de remarketing colapsa pra 1 candidato", () => {
    const nodes: CapturedNodeForFlow[] = [
      node({ id: "root", messages: [msg({ buttons: [btn()] })] }),
      node({ id: "rm_1", messages: [msg({ buttons: [btn()] })] }),
      node({ id: "rm_2", messages: [msg({ buttons: [btn()] })] }),
    ];
    const candidates = collectPriceCandidates(nodes);
    expect(candidates.size).toBe(1);
    const only = [...candidates.values()][0];
    expect(only.cents).toBe(1593);
    expect(only.label).toBe("Vip Mensal por R$ 15.93");
  });

  it("mesmo nome de plano com preço diferente (oferta de remarketing com desconto) vira candidato distinto", () => {
    const nodes: CapturedNodeForFlow[] = [
      node({ id: "root", messages: [msg({ buttons: [btn({ label: "Vip Mensal por R$ 15.93" })] })] }),
      node({ id: "rm_1", messages: [msg({ buttons: [btn({ label: "Vip Mensal por R$ 13.54" })] })] }),
    ];
    const candidates = collectPriceCandidates(nodes);
    expect(candidates.size).toBe(2);
  });

  it("botão clicado de verdade (skip:false) nunca vira candidato, mesmo com preço no rótulo", () => {
    const nodes: CapturedNodeForFlow[] = [node({ messages: [msg({ buttons: [btn({ skip: false, skipReason: null })] })] })];
    expect(collectPriceCandidates(nodes).size).toBe(0);
  });

  it("botão de link (kind:url) nunca vira candidato, mesmo com preço no rótulo e skip:true", () => {
    const nodes: CapturedNodeForFlow[] = [
      node({ messages: [msg({ buttons: [btn({ kind: "url", url: "https://x.com", skipReason: "url_button_not_clicked" })] })] }),
    ];
    expect(collectPriceCandidates(nodes).size).toBe(0);
  });

  it("botão sem preço extraível no rótulo não vira candidato", () => {
    const nodes: CapturedNodeForFlow[] = [node({ messages: [msg({ buttons: [btn({ label: "Continuar", skipReason: "generic_confirm_requires_review" })] })] })];
    expect(collectPriceCandidates(nodes).size).toBe(0);
  });
});
