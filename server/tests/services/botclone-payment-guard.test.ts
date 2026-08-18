import { describe, it, expect } from "vitest";
import { Api } from "telegram";
import {
  classifyButton,
  mapRawButton,
  scanForPaymentConfirmation,
  type RawButtonInfo,
} from "../../src/services/mtproto/bot-clone/payment-guard.js";

const NO_CONTEXT = "";

describe("mapRawButton — falha fechado", () => {
  it("KeyboardButtonCallback vira callback, com requiresPassword", () => {
    const btn = new Api.KeyboardButtonCallback({
      text: "Ver mais",
      data: Buffer.from("x"),
      requiresPassword: true,
    } as never);
    expect(mapRawButton(btn)).toEqual({ kind: "callback", label: "Ver mais", requiresPassword: true });
  });

  it("KeyboardButtonUrl vira url", () => {
    const btn = new Api.KeyboardButtonUrl({ text: "Site", url: "https://a.com" } as never);
    expect(mapRawButton(btn)).toEqual({ kind: "url", label: "Site", url: "https://a.com" });
  });

  it("KeyboardButtonUrlAuth vira url_auth", () => {
    const btn = new Api.KeyboardButtonUrlAuth({ text: "Login", url: "https://a.com", buttonId: 1 } as never);
    expect(mapRawButton(btn).kind).toBe("url_auth");
  });

  it("KeyboardButtonSwitchInline vira switch_inline", () => {
    const btn = new Api.KeyboardButtonSwitchInline({ text: "Compartilhar", query: "" } as never);
    expect(mapRawButton(btn).kind).toBe("switch_inline");
  });

  it("KeyboardButtonGame vira game", () => {
    expect(mapRawButton(new Api.KeyboardButtonGame({ text: "Jogar" } as never)).kind).toBe("game");
  });

  it("KeyboardButtonBuy vira buy", () => {
    expect(mapRawButton(new Api.KeyboardButtonBuy({ text: "Comprar" } as never)).kind).toBe("buy");
  });

  it("KeyboardButtonWebView vira webview", () => {
    expect(mapRawButton(new Api.KeyboardButtonWebView({ text: "Abrir", url: "https://a.com" } as never)).kind).toBe(
      "webview",
    );
  });

  it("KeyboardButtonSimpleWebView vira simple_webview", () => {
    expect(
      mapRawButton(new Api.KeyboardButtonSimpleWebView({ text: "Abrir", url: "https://a.com" } as never)).kind,
    ).toBe("simple_webview");
  });

  it("KeyboardButton puro (teclado de resposta) vira reply_keyboard_text", () => {
    expect(mapRawButton(new Api.KeyboardButton({ text: "Enviar contato" } as never)).kind).toBe(
      "reply_keyboard_text",
    );
  });

  it("tipo desconhecido/não mapeado vira unknown, nunca callback por default", () => {
    const fake = {} as Api.TypeKeyboardButton; // não é instanceof de nada mapeado
    expect(mapRawButton(fake).kind).toBe("unknown");
  });
});

describe("classifyButton — categorias sempre puladas, independente do rótulo", () => {
  const innocentLabels = ["Ver detalhes", "Saiba mais", "Continuar"];

  it.each(["buy", "webview", "simple_webview", "game", "switch_inline", "url_auth", "reply_keyboard_text", "unknown"] as const)(
    "kind=%s sempre skip, mesmo com rótulo inocente",
    (kind) => {
      for (const label of innocentLabels) {
        const decision = classifyButton({ kind, label }, NO_CONTEXT);
        expect(decision.action).toBe("skip");
      }
    },
  );

  it("requiresPassword sempre skip, mesmo com rótulo inocente", () => {
    const decision = classifyButton(
      { kind: "callback", label: "Ver detalhes", requiresPassword: true },
      NO_CONTEXT,
    );
    expect(decision).toEqual({ action: "skip", reason: "requires_password_2fa_gated" });
  });
});

describe("classifyButton — palavras-chave de pagamento (PT/EN) no rótulo", () => {
  const paymentLabels = [
    "Comprar agora", "Quero comprar", "Pagar com Pix", "Assinar plano VIP",
    "Finalizar compra", "Confirmar pagamento", "Gerar Pix", "Liberar acesso",
    "Desbloquear conteúdo", "Renovar assinatura", "Plano Premium",
    "Buy now", "Purchase", "Pay with card", "Subscribe now", "Checkout",
    "Order now", "Get access", "Unlock content", "Upgrade to VIP",
    "R$ 49,90", "12x de R$ 9,90",
  ];

  it.each(paymentLabels)("%s → skip (payment_keyword_match)", (label) => {
    const decision = classifyButton({ kind: "callback", label }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "payment_keyword_match" });
  });
});

describe("classifyButton — confirmação genérica isolada (achado #1)", () => {
  const genericLabels = ["Continuar", "OK", "Sim", "Confirmar", "Prosseguir", "Avançar", "Próximo", "Yes", "Confirm", "Continue", "Next"];

  it.each(genericLabels)("%s sozinho → skip (generic_confirm_requires_review), mesmo sem palavra-chave", (label) => {
    const decision = classifyButton({ kind: "callback", label }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "generic_confirm_requires_review" });
  });

  it("emoji de confirmação + palavra genérica ainda conta como genérico", () => {
    const decision = classifyButton({ kind: "callback", label: "✅ Continuar" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "generic_confirm_requires_review" });
  });
});

describe("classifyButton — rótulo emoji-only (achado #5)", () => {
  it("só emoji, sem nenhuma letra → skip (non_text_label_unverifiable)", () => {
    const decision = classifyButton({ kind: "callback", label: "💳" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "non_text_label_unverifiable" });
  });

  it("botão de URL com rótulo emoji-only ainda vira open_url_only (nunca dispara RPC)", () => {
    const decision = classifyButton({ kind: "url", label: "➡️", url: "https://exemplo.com" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "open_url_only", paymentDomainMatch: false });
  });
});

describe("classifyButton — preço/contexto no texto da mensagem, não no rótulo (achado #6)", () => {
  it("rótulo genérico + preço no corpo da mensagem → skip", () => {
    const decision = classifyButton(
      { kind: "callback", label: "Garantir" },
      "🔥 R$97 apenas hoje! Toque para garantir.",
    );
    expect(decision).toEqual({ action: "skip", reason: "payment_keyword_match" });
  });

  it("rótulo sem nada suspeito e mensagem sem nada suspeito → click", () => {
    const decision = classifyButton({ kind: "callback", label: "Ver detalhes" }, "Aqui está mais informação.");
    expect(decision.action).toBe("click");
  });
});

describe("classifyButton — homóglifo / NFKC (achado #9)", () => {
  it("rótulo com caractere fullwidth ainda é reconhecido como palavra-chave", () => {
    // "buy" em fullwidth Unicode (compatibilidade NFKC decompõe pra ASCII).
    const decision = classifyButton({ kind: "callback", label: "ＢＵＹ now" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "payment_keyword_match" });
  });

  it("acento não impede o match da palavra-chave", () => {
    const decision = classifyButton({ kind: "callback", label: "Página de pagamento" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "payment_keyword_match" });
  });

  it("rótulo TOTALMENTE em cirílico (visualmente 'Comprar') → skip", () => {
    // Сомрар = letras cirílicas visualmente
    // idênticas a "Comprar" — nenhuma delas é [a-z] ASCII.
    const decision = classifyButton({ kind: "callback", label: "Сомрар" }, NO_CONTEXT);
    expect(decision.action).toBe("skip");
  });

  it("BUG REAL corrigido nesta revisão: rótulo MISTO (1 letra cirílica + resto latino) escapava do filtro — agora skip", () => {
    // С é a letra cirílica maiúscula visualmente idêntica ao "C" latino
    // (U+0043). "Сomprar agora" tem letras ASCII suficientes ("omprar
    // agora") pra passar a checagem de "sem letra ASCII" — e o С não
    // bate contra /\bcomprar\b/ (código de caractere diferente do "c"
    // latino), então também não batia PAYMENT_KEYWORD_PATTERNS. Verificado
    // empiricamente ANTES do fix: retornava { action: "click" }.
    const decision = classifyButton({ kind: "callback", label: "Сomprar agora" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "non_latin_script_label_unverifiable" });
  });

  it("mesmo bug, com um rótulo de confirmação genérica ('Confirmar' com C cirílico) → skip", () => {
    const decision = classifyButton({ kind: "callback", label: "Сonfirmar" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "non_latin_script_label_unverifiable" });
  });

  it("letra grega isolada misturada em rótulo latino → skip", () => {
    // Α = Alpha grego maiúsculo, visualmente idêntico ao "A" latino.
    const decision = classifyButton({ kind: "callback", label: "PΑGAR agora" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "skip", reason: "non_latin_script_label_unverifiable" });
  });

  it("rótulo puramente latino/ASCII não é afetado pela checagem de script", () => {
    const decision = classifyButton({ kind: "callback", label: "Ver mais detalhes" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "click" });
  });
});

describe("classifyButton — negativos: navegação comum sempre clica", () => {
  it.each(["Voltar", "Menu principal", "Back", "Ver detalhes", "Saiba mais", "More info"])(
    "%s → click",
    (label) => {
      const decision = classifyButton({ kind: "callback", label }, NO_CONTEXT);
      expect(decision).toEqual({ action: "click" });
    },
  );
});

describe("classifyButton — botão de URL", () => {
  it("URL de domínio de pagamento conhecido: open_url_only com paymentDomainMatch=true", () => {
    const decision = classifyButton(
      { kind: "url", label: "Pagar agora", url: "https://checkout.stripe.com/session/123" },
      NO_CONTEXT,
    );
    expect(decision).toEqual({ action: "open_url_only", paymentDomainMatch: true });
  });

  it("URL comum: open_url_only com paymentDomainMatch=false", () => {
    const decision = classifyButton({ kind: "url", label: "Site", url: "https://meusite.com" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "open_url_only", paymentDomainMatch: false });
  });

  it("URL malformada não quebra — paymentDomainMatch=false", () => {
    const decision = classifyButton({ kind: "url", label: "Site", url: "não é url" }, NO_CONTEXT);
    expect(decision).toEqual({ action: "open_url_only", paymentDomainMatch: false });
  });
});

describe("scanForPaymentConfirmation", () => {
  it.each([
    "Pagamento aprovado ✅", "Pedido confirmado", "Compra realizada com sucesso",
    "Aqui está seu recibo", "Payment approved", "Transaction ID: 12345",
  ])("%s → true", (text) => {
    expect(scanForPaymentConfirmation(text)).toBe(true);
  });

  it("texto comum sem confirmação de pagamento → false", () => {
    expect(scanForPaymentConfirmation("Escolha uma opção abaixo:")).toBe(false);
  });
});
