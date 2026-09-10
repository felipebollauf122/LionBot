import { describe, it, expect } from "vitest";
import { accumulateSchedule, type SchedulableRow } from "@/lib/composer/schedule";

function r(id: string, delay: number, descartada = false): SchedulableRow {
  return { id, delay_seconds: delay, ai_discarded: descartada };
}

const INICIO = new Date("2026-09-10T12:00:00.000Z");

describe("accumulateSchedule", () => {
  it("a primeira mensagem sai no horário de início, sem esperar o próprio delay", () => {
    const out = accumulateSchedule([r("a", 600)], INICIO);
    expect(out).toEqual([{ id: "a", scheduledAt: INICIO }]);
  });

  it("cada delay é somado ao horário da mensagem anterior", () => {
    const out = accumulateSchedule([r("a", 600), r("b", 300), r("c", 900)], INICIO);
    expect(out.map((o) => o.scheduledAt.toISOString())).toEqual([
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T12:05:00.000Z", // +300s
      "2026-09-10T12:20:00.000Z", // +900s
    ]);
  });

  it("descartada pela IA não entra no resultado nem consome o próprio delay", () => {
    // 'b' foi descartada: 'c' herda a vez dela e espera o delay DE 'c'
    // contado a partir de 'a'. Somar o delay de uma mensagem que não vai ao ar
    // abriria um buraco silencioso na cadência.
    const out = accumulateSchedule([r("a", 600), r("b", 3600, true), r("c", 300)], INICIO);
    expect(out).toEqual([
      { id: "a", scheduledAt: new Date("2026-09-10T12:00:00.000Z") },
      { id: "c", scheduledAt: new Date("2026-09-10T12:05:00.000Z") },
    ]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(accumulateSchedule([], INICIO)).toEqual([]);
  });

  it("lista só de descartadas devolve lista vazia", () => {
    expect(accumulateSchedule([r("a", 60, true), r("b", 60, true)], INICIO)).toEqual([]);
  });

  it("delay negativo ou zero não faz o horário andar pra trás", () => {
    const out = accumulateSchedule([r("a", 0), r("b", -100), r("c", 60)], INICIO);
    expect(out.map((o) => o.scheduledAt.toISOString())).toEqual([
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T12:01:00.000Z",
    ]);
  });
});
