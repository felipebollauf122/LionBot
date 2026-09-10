import { describe, it, expect } from "vitest";
import { nextFloodSchedule } from "../../src/workers/scheduled-campaign-handler.js";

const AGORA = new Date("2026-09-10T12:00:00.000Z");

describe("nextFloodSchedule", () => {
  it("a mensagem que bateu flood volta pra depois da espera, com folga de 5s", () => {
    const r = nextFloodSchedule({ now: AGORA, waitSeconds: 60, pendentes: [] });
    expect(r.retryAt.toISOString()).toBe("2026-09-10T12:01:05.000Z");
  });

  it("as seguintes são empurradas pelo MESMO delta, preservando a cadência", () => {
    // Sem o empurrão, a fila inteira vence durante o flood e o bot despeja
    // tudo de uma vez quando ele passa — que é o que queima a conta.
    const r = nextFloodSchedule({
      now: AGORA,
      waitSeconds: 60,
      pendentes: [
        { id: "b", scheduledAt: new Date("2026-09-10T12:10:00.000Z") },
        { id: "c", scheduledAt: new Date("2026-09-10T12:20:00.000Z") },
      ],
    });
    expect(r.empurradas).toEqual([
      { id: "b", scheduledAt: new Date("2026-09-10T12:11:05.000Z") },
      { id: "c", scheduledAt: new Date("2026-09-10T12:21:05.000Z") },
    ]);
  });

  it("não empurra nada quando não há pendentes depois", () => {
    const r = nextFloodSchedule({ now: AGORA, waitSeconds: 30, pendentes: [] });
    expect(r.empurradas).toEqual([]);
  });

  it("uma pendente que já estava atrasada é empurrada a partir de agora, não do passado", () => {
    // Sem esse piso, uma mensagem já vencida continuaria vencida depois do
    // flood e sairia junto com a que acabou de ser reagendada.
    const r = nextFloodSchedule({
      now: AGORA,
      waitSeconds: 60,
      pendentes: [{ id: "b", scheduledAt: new Date("2026-09-10T11:50:00.000Z") }],
    });
    expect(r.empurradas[0].scheduledAt.toISOString()).toBe("2026-09-10T12:01:05.000Z");
  });
});
