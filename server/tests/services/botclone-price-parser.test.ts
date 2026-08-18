import { describe, it, expect } from "vitest";
import { parsePriceCentsFromLabel, normalizeLabelForDedupKey } from "../../src/services/mtproto/bot-clone/price-parser.js";

describe("parsePriceCentsFromLabel", () => {
  it("rótulos reais capturados do job @dudinha0f1c1al_bot", () => {
    expect(parsePriceCentsFromLabel("🌸Vip Mensal🌸 por R$ 15.93")).toBe(1593);
    expect(parsePriceCentsFromLabel("🌸Vip Mensal🌸 por R$ 13.54")).toBe(1354);
    expect(parsePriceCentsFromLabel("🏅VITALÍCIO + CHAMADA 🏅 por R$ 16.93")).toBe(1693);
  });

  it("separador de milhar + decimal (formato BR e US)", () => {
    expect(parsePriceCentsFromLabel("R$ 1.234,56")).toBe(123456);
    expect(parsePriceCentsFromLabel("$ 1,234.56")).toBe(123456);
  });

  it("separador único de milhar sem centavos (R$1.500 = R$1.500,00)", () => {
    expect(parsePriceCentsFromLabel("R$ 1.500")).toBe(150000);
  });

  it("parcelamento vira valor total (parcelas x valor)", () => {
    expect(parsePriceCentsFromLabel("12x de R$ 9,90")).toBe(11880);
  });

  it("sem preço extraível vira null (rótulo continua caindo em unmapped)", () => {
    expect(parsePriceCentsFromLabel("Comprar agora")).toBeNull();
  });

  it("número sem símbolo de moeda não é tratado como preço", () => {
    expect(parsePriceCentsFromLabel("1.234.567")).toBeNull();
  });

  it("múltiplos preços no rótulo usa o último mencionado (De X por Y)", () => {
    expect(parsePriceCentsFromLabel("De R$97 por R$47")).toBe(4700);
  });

  it("sem separador nenhum vira reais cheios, sem inflar por engano", () => {
    expect(parsePriceCentsFromLabel("R$1990")).toBe(199000);
  });
});

describe("normalizeLabelForDedupKey", () => {
  it("normaliza espaço e caixa pra colapsar repetições do mesmo rótulo", () => {
    expect(normalizeLabelForDedupKey("  Vip Mensal  por R$ 15.93 ")).toBe(
      normalizeLabelForDedupKey("Vip Mensal por R$ 15.93"),
    );
    expect(normalizeLabelForDedupKey("VIP MENSAL")).toBe(normalizeLabelForDedupKey("vip mensal"));
  });

  it("rótulos com preços diferentes não colapsam pra mesma chave", () => {
    expect(normalizeLabelForDedupKey("Vip Mensal por R$ 15.93")).not.toBe(
      normalizeLabelForDedupKey("Vip Mensal por R$ 13.54"),
    );
  });
});
