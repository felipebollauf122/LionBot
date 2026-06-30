import { describe, it, expect } from "vitest";
import { customAlphabet } from "nanoid";

/**
 * Regressão do bug do black flow: o tid é gerado na /t e re-extraído no /start
 * do Telegram com sanitização `[^a-zA-Z0-9_]` (server/src/webhook/telegram.ts).
 * O nanoid PADRÃO usa A-Za-z0-9_- (com hífen) → tids com '-' eram alterados no
 * /start e nunca batiam com o tracking_event → black flow caía no visual_flow.
 *
 * Aqui garantimos que o alfabeto do tid sobrevive INTACTO à sanitização.
 */

// Mesmo alfabeto usado em app/t/page.tsx (sem '-' e sem '_').
const TID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const tidNanoid = customAlphabet(TID_ALPHABET, 16);

// Mesma sanitização do extractTidFromPayload no servidor.
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "");

describe("tid sobrevive à sanitização do /start", () => {
  it("o alfabeto do tid não contém '-' nem caracteres removidos pela sanitização", () => {
    expect(TID_ALPHABET).not.toContain("-");
    // cada char do alfabeto deve passar intacto pela sanitização
    for (const ch of TID_ALPHABET) {
      expect(sanitize(ch)).toBe(ch);
    }
  });

  it("1000 tids gerados batem EXATAMENTE depois de sanitizar (com prefixo tid_)", () => {
    for (let i = 0; i < 1000; i++) {
      const tid = `tid_${tidNanoid(16)}`;
      expect(sanitize(tid)).toBe(tid); // idêntico — nunca alterado
    }
  });

  it("contraprova: o nanoid PADRÃO (com '-') QUEBRARIA aqui", () => {
    // demonstra o bug antigo: um tid com hífen é alterado pela sanitização.
    const buggy = "tid_Ab3-x9Kp_2mNq-7R";
    expect(sanitize(buggy)).not.toBe(buggy); // perde os hífens → não bate
  });
});
