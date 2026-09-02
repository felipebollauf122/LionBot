import { describe, it, expect } from "vitest";
import { moveItem } from "@/lib/social-proof/reorder";

const base = ["a", "b", "c", "d"];

describe("moveItem", () => {
  it("move para frente", () => {
    expect(moveItem(base, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("move para trás", () => {
    expect(moveItem(base, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("move para o fim", () => {
    expect(moveItem(base, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("move para o começo", () => {
    expect(moveItem(base, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("mover para a própria posição não muda nada", () => {
    expect(moveItem(base, 1, 1)).toEqual(base);
  });

  it("não muta a lista original", () => {
    const copia = [...base];
    moveItem(base, 0, 3);
    expect(base).toEqual(copia);
  });

  it("índice fora do intervalo devolve a lista intacta", () => {
    // Arrastar pra fora da área solta um índice inválido; melhor ignorar que
    // embaralhar a lista do tenant.
    expect(moveItem(base, -1, 2)).toEqual(base);
    expect(moveItem(base, 0, 99)).toEqual(base);
    expect(moveItem(base, 99, 0)).toEqual(base);
  });

  it("lista vazia ou de um item não quebra", () => {
    expect(moveItem([], 0, 0)).toEqual([]);
    expect(moveItem(["a"], 0, 0)).toEqual(["a"]);
  });
});
