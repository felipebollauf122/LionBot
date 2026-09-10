import { describe, it, expect } from "vitest";
import { describeSendError } from "@/lib/composer/message-error";

describe("describeSendError", () => {
  it("sem erro, nada a mostrar", () => {
    expect(describeSendError(null)).toBeNull();
    expect(describeSendError(undefined)).toBeNull();
  });

  it("reconhece as frases que o próprio worker escreve e devolve um texto curto em português", () => {
    expect(describeSendError("campanha sem canal de destino")).toBe(
      "A campanha ficou sem canal de destino definido.",
    );
    expect(describeSendError("bot companheiro não cadastrado ou inválido")).toMatch(/Automações/);
    expect(describeSendError("download da mídia falhou (404): https://x/y.jpg")).toMatch(/mídia/i);
    expect(describeSendError("mensagem photo sem mídia gravada")).toMatch(/mídia/i);
  });

  it("erro cru do Telegram/Bot API (inglês) nunca aparece — vira a frase genérica", () => {
    const cru = "GrammyError: 400: Bad Request: chat not found";
    const texto = describeSendError(cru);
    expect(texto).toBe("Houve um problema ao publicar esta mensagem.");
    expect(texto).not.toContain(cru);
    expect(texto?.toLowerCase()).not.toMatch(/bad request|grammy/);
  });

  it("qualquer outro texto não catalogado também vira a frase genérica, nunca a string crua", () => {
    expect(describeSendError("qualquer coisa esquisita")).toBe(
      "Houve um problema ao publicar esta mensagem.",
    );
  });
});
