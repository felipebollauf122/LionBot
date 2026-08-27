import { describe, it, expect, vi } from "vitest";

// payment-button.ts importa queue.js (addPaymentTimeoutJob), que lê env vars
// de config.ts (Redis/BullMQ) no import — mesmo mock que flow-processor.test.ts
// já usa pra não estourar "Missing environment variable" só por importar o
// módulo pra testar uma função pura dele.
vi.mock("../../../src/queue.js", () => ({
  addPaymentTimeoutJob: vi.fn(),
  addDelayedJob: vi.fn(),
}));

// lead-messages.js (importado por payment-button.ts pra logEvent) importa o
// singleton `supabase` de db.js, que lê env vars no import — mesmo problema
// do queue.js acima. tests/setup.ts já mocka "../src/db" globalmente, mas
// esse caminho relativo é resolvido a partir de setup.ts; remockar aqui
// também, explícito, evita depender de coincidência de resolução de módulo.
vi.mock("../../../src/db.js", () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import { sanitizeEmailForGateway } from "../../../src/engine/nodes/payment-button.js";

describe("sanitizeEmailForGateway", () => {
  it("keeps a well-formed email as-is", () => {
    expect(sanitizeEmailForGateway("joao@gmail.com", 123)).toBe("joao@gmail.com");
  });

  it("trims surrounding whitespace on an otherwise valid email", () => {
    expect(sanitizeEmailForGateway("  joao@gmail.com  ", 123)).toBe("joao@gmail.com");
  });

  it("falls back to the synthetic placeholder when state.email is missing", () => {
    expect(sanitizeEmailForGateway(undefined, 555)).toBe("555@eaglebot.temp");
    expect(sanitizeEmailForGateway(null, 555)).toBe("555@eaglebot.temp");
    expect(sanitizeEmailForGateway("", 555)).toBe("555@eaglebot.temp");
  });

  it("falls back when the email has non-ASCII characters (reproduces the reported Poseidon 400)", () => {
    // Caso real: o validador do nó "Pergunta" (input.ts) é frouxo de
    // propósito e aceita acento — a Poseidon rejeitou exatamente isso com
    // 400 "client.email: Invalid email".
    expect(sanitizeEmailForGateway("joão@gmail.com", 555)).toBe("555@eaglebot.temp");
  });

  it("falls back on structurally invalid strings that a loose regex would still accept", () => {
    expect(sanitizeEmailForGateway("nao é um email", 555)).toBe("555@eaglebot.temp");
    expect(sanitizeEmailForGateway("sem-arroba.com", 555)).toBe("555@eaglebot.temp");
    expect(sanitizeEmailForGateway("a@b", 555)).toBe("555@eaglebot.temp"); // sem TLD
  });
});
