import { describe, it, expect } from "vitest";
import {
  offsetToDate,
  formatClock,
  formatDaySeparator,
  formatViews,
  isSameDay,
} from "@/lib/social-proof/format";

const now = new Date("2026-09-01T15:00:00-03:00");

describe("offsetToDate", () => {
  it("subtrai o offset do agora", () => {
    expect(offsetToDate(900, now).toISOString()).toBe(
      new Date("2026-09-01T14:45:00-03:00").toISOString(),
    );
  });

  it("offset zero é o próprio agora", () => {
    expect(offsetToDate(0, now).getTime()).toBe(now.getTime());
  });

  it("offset negativo não joga a mensagem pro futuro", () => {
    // Tenant digitou errado: tratamos como "agora", nunca como futuro,
    // porque mensagem com hora futura denuncia a simulação na hora.
    expect(offsetToDate(-500, now).getTime()).toBe(now.getTime());
  });
});

describe("formatClock", () => {
  it("usa 24h com zero à esquerda, no fuso de Brasília", () => {
    expect(formatClock(new Date("2026-09-01T09:05:00-03:00"))).toBe("09:05");
  });

  it("formata hora da tarde sem AM/PM", () => {
    expect(formatClock(new Date("2026-09-01T21:47:00-03:00"))).toBe("21:47");
  });
});

describe("isSameDay", () => {
  it("mesma data no fuso de Brasília", () => {
    expect(
      isSameDay(new Date("2026-09-01T01:00:00-03:00"), new Date("2026-09-01T23:00:00-03:00")),
    ).toBe(true);
  });

  it("dias diferentes", () => {
    expect(
      isSameDay(new Date("2026-08-31T23:00:00-03:00"), new Date("2026-09-01T01:00:00-03:00")),
    ).toBe(false);
  });
});

describe("formatDaySeparator", () => {
  it("hoje", () => {
    expect(formatDaySeparator(new Date("2026-09-01T08:00:00-03:00"), now)).toBe("Hoje");
  });

  it("ontem", () => {
    expect(formatDaySeparator(new Date("2026-08-31T08:00:00-03:00"), now)).toBe("Ontem");
  });

  it("mais antigo vira data por extenso", () => {
    expect(formatDaySeparator(new Date("2026-08-12T08:00:00-03:00"), now)).toBe("12 de agosto");
  });
});

describe("formatViews", () => {
  it("abaixo de mil é exato", () => {
    expect(formatViews(0)).toBe("0");
    expect(formatViews(987)).toBe("987");
  });

  it("milhares usam K com uma casa e vírgula", () => {
    expect(formatViews(1200)).toBe("1,2K");
    expect(formatViews(15300)).toBe("15,3K");
  });

  it("descarta a casa decimal quando é zero", () => {
    expect(formatViews(1000)).toBe("1K");
    expect(formatViews(42000)).toBe("42K");
  });

  it("trunca em vez de arredondar pra cima", () => {
    // 1999 não pode virar "2K": o número exibido nunca deve passar do real.
    expect(formatViews(1999)).toBe("1,9K");
  });

  it("milhões usam M", () => {
    expect(formatViews(1200000)).toBe("1,2M");
  });

  it("negativo é tratado como zero", () => {
    expect(formatViews(-5)).toBe("0");
  });
});
