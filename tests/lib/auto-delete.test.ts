import { describe, it, expect } from "vitest";
import {
  AUTO_DELETE_MAX_SECONDS,
  autoDeleteSeconds,
  formatAutoDelete,
} from "@/components/dashboard/flow-builder/flow-utils";

describe("autoDeleteSeconds", () => {
  it("converte minutos e horas para segundos", () => {
    expect(autoDeleteSeconds(30, "seconds")).toBe(30);
    expect(autoDeleteSeconds(5, "minutes")).toBe(300);
    expect(autoDeleteSeconds(2, "hours")).toBe(7200);
  });

  it("trata valor ausente, zero ou negativo como desligado", () => {
    expect(autoDeleteSeconds(0, "minutes")).toBe(0);
    expect(autoDeleteSeconds(-5, "minutes")).toBe(0);
    expect(autoDeleteSeconds(Number.NaN, "minutes")).toBe(0);
  });

  it("desliga quando a unidade não é reconhecida", () => {
    expect(autoDeleteSeconds(10, "weeks")).toBe(0);
  });

  it("limita o tempo máximo a 24h", () => {
    expect(autoDeleteSeconds(48, "hours")).toBe(AUTO_DELETE_MAX_SECONDS);
    expect(AUTO_DELETE_MAX_SECONDS).toBe(86400);
  });

  it("arredonda fração para baixo — delete_at é em segundos inteiros", () => {
    expect(autoDeleteSeconds(1.9, "seconds")).toBe(1);
  });
});

describe("formatAutoDelete", () => {
  it("usa a maior unidade exata para o rótulo do bloco", () => {
    expect(formatAutoDelete(45)).toBe("45s");
    expect(formatAutoDelete(300)).toBe("5min");
    expect(formatAutoDelete(7200)).toBe("2h");
  });

  it("cai para segundos quando não fecha em minuto cheio", () => {
    expect(formatAutoDelete(90)).toBe("90s");
  });

  it("devolve string vazia quando está desligado", () => {
    expect(formatAutoDelete(0)).toBe("");
  });
});
