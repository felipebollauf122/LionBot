import { describe, it, expect } from "vitest";
import { normalizeReactions } from "@/lib/social-proof/reactions";

describe("normalizeReactions", () => {
  it("lista vazia quando não há nada", () => {
    expect(normalizeReactions([])).toEqual([]);
  });

  it("entrada que não é array vira lista vazia sem lançar", () => {
    expect(normalizeReactions(null)).toEqual([]);
    expect(normalizeReactions(undefined)).toEqual([]);
    expect(normalizeReactions("isso não é lista")).toEqual([]);
    expect(normalizeReactions(42)).toEqual([]);
  });

  it("descarta item sem emoji", () => {
    expect(normalizeReactions([{ count: 3 }])).toEqual([]);
  });

  it("descarta item cujo emoji é objeto — o caso que derruba o React", () => {
    expect(normalizeReactions([{ emoji: { x: 1 }, count: 1 }])).toEqual([]);
  });

  it("descarta item com emoji vazio", () => {
    expect(normalizeReactions([{ emoji: "", count: 1 }])).toEqual([]);
  });

  it("descarta item com count não numérico", () => {
    expect(normalizeReactions([{ emoji: "🔥", count: "3" }])).toEqual([]);
    expect(normalizeReactions([{ emoji: "🔥", count: null }])).toEqual([]);
    expect(normalizeReactions([{ emoji: "🔥", count: NaN }])).toEqual([]);
  });

  it("count negativo vira 0", () => {
    expect(normalizeReactions([{ emoji: "🔥", count: -5 }])).toEqual([{ emoji: "🔥", count: 0 }]);
  });

  it("count fracionário é truncado", () => {
    expect(normalizeReactions([{ emoji: "🔥", count: 3.7 }])).toEqual([{ emoji: "🔥", count: 3 }]);
  });

  it("item que não é objeto é descartado sem derrubar os outros", () => {
    expect(normalizeReactions([null, "x", 42, { emoji: "🙏", count: 1 }])).toEqual([
      { emoji: "🙏", count: 1 },
    ]);
  });

  it("lista válida passa intacta", () => {
    const entrada = [
      { emoji: "❤️", count: 10 },
      { emoji: "🔥", count: 2 },
    ];
    expect(normalizeReactions(entrada)).toEqual(entrada);
  });
});
