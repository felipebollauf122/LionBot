import { describe, it, expect } from "vitest";
import { nextPosition } from "@/lib/social-proof/position";

describe("nextPosition", () => {
  it("começa em 1 quando o canal não tem mensagem nenhuma", () => {
    expect(nextPosition(null)).toBe(1);
    expect(nextPosition(undefined)).toBe(1);
  });

  it("é max+1, e não length+1 — o bug de colisão do composer", () => {
    // Cenário real: 3 mensagens (positions 1,2,3), o tenant apaga a do meio e
    // RECARREGA a página. O composer usava messages.length + 1 → 2 mensagens
    // restantes → position 3, valor que a última já ocupa. max+1 devolve 4.
    expect(nextPosition(3)).toBe(4);
  });

  it("não volta atrás mesmo com buracos no meio da numeração", () => {
    expect(nextPosition(10)).toBe(11);
  });

  it("nunca devolve 0 ou negativo (a coluna tem default 0 no banco)", () => {
    expect(nextPosition(0)).toBe(1);
    expect(nextPosition(-5)).toBe(1);
  });

  it("ignora valor não numérico vindo do banco", () => {
    expect(nextPosition(Number.NaN)).toBe(1);
  });
});
