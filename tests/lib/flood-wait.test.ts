import { describe, it, expect } from "vitest";
import {
  parseFloodWait,
  describeFloodWait,
  messageFloodHint,
  earliestFloodWait,
} from "@/lib/composer/flood-wait";

describe("parseFloodWait", () => {
  it("reconhece o formato exato que o worker grava", () => {
    const r = parseFloodWait("flood_wait_300s", "2026-09-10T12:05:00-03:00");
    expect(r).toEqual({
      waitSeconds: 300,
      resumesAt: new Date("2026-09-10T12:05:00-03:00"),
    });
  });

  it("erro de verdade (não flood) não é confundido com espera de limite", () => {
    expect(parseFloodWait("CHAT_WRITE_FORBIDDEN", "2026-09-10T12:05:00-03:00")).toBeNull();
  });

  it("sem error_message não há o que traduzir", () => {
    expect(parseFloodWait(null, "2026-09-10T12:05:00-03:00")).toBeNull();
  });

  it("sem scheduled_at não há quando dizer que volta", () => {
    expect(parseFloodWait("flood_wait_300s", null)).toBeNull();
  });

  it("scheduled_at inválido não quebra, só devolve null", () => {
    expect(parseFloodWait("flood_wait_300s", "not-a-date")).toBeNull();
  });
});

describe("describeFloodWait", () => {
  const agora = new Date("2026-09-10T23:50:00-03:00");

  it("nomeia o Telegram como origem do limite e diz quando volta, sem o termo técnico", () => {
    const texto = describeFloodWait(
      { waitSeconds: 300, resumesAt: new Date("2026-09-10T12:05:00-03:00") },
      agora,
    );
    expect(texto).toContain("Telegram");
    expect(texto).toContain("12:05");
    // Escrito pra quem não sabe o que é "flood wait" — a string crua do
    // banco não pode vazar pro texto amigável.
    expect(texto.toLowerCase()).not.toContain("flood");
  });

  it("mesmo dia de `now`: só a hora, sem data — não precisa dizer o óbvio", () => {
    const texto = describeFloodWait(
      { waitSeconds: 60, resumesAt: new Date("2026-09-10T23:59:00-03:00") },
      agora,
    );
    expect(texto).toContain("às 23:59");
    expect(texto).not.toMatch(/\bdia\b/);
  });

  it("espera que atravessa a meia-noite: a data entra na frase, não só a hora", () => {
    // Os empurrões de reagendarPorFlood se somam entre mensagens — uma
    // campanha grande pode facilmente empurrar a espera pro dia seguinte.
    // Sem a data, o aviso lê como se fosse resolver ainda hoje.
    const texto = describeFloodWait(
      { waitSeconds: 600, resumesAt: new Date("2026-09-11T00:10:00-03:00") },
      agora,
    );
    expect(texto).toContain("00:10");
    expect(texto).toMatch(/dia 11 de setembro/);
  });

  it("resume já passou e foi ONTEM: gramática correta, sem 'no dia' colado com Ontem/Hoje", () => {
    // Fix A da rodada: um worker parado deixa uma linha pending cujo
    // scheduled_at (resumesAt) já passou — pode ser de ontem. O código velho
    // só tratava "Hoje" como caso especial; "Ontem" caía no ramo genérico e
    // produzia "no dia Ontem, às 12:05", que não é português. A comparação
    // certa é por DATA (isSameDay), não por casar a string que
    // formatDaySeparator devolve.
    const texto = describeFloodWait(
      { waitSeconds: 300, resumesAt: new Date("2026-09-09T12:05:00-03:00") },
      new Date("2026-09-10T10:00:00-03:00"),
    );
    expect(texto).toContain("12:05");
    expect(texto.toLowerCase()).toContain("ontem");
    expect(texto).not.toMatch(/no dia ontem/i);
  });

  it("sem `now` explícito, usa o agora real (não quebra)", () => {
    const texto = describeFloodWait({
      waitSeconds: 300,
      resumesAt: new Date(Date.now() + 60_000),
    });
    expect(texto).toContain("Telegram");
  });
});

describe("messageFloodHint", () => {
  it("linha em espera de limite devolve o texto amigável", () => {
    const hint = messageFloodHint("flood_wait_60s", "2026-09-10T09:01:00-03:00");
    expect(hint).toContain("09:01");
  });

  it("linha sem flood devolve null (chip sem tooltip especial)", () => {
    expect(messageFloodHint(null, null)).toBeNull();
  });
});

describe("earliestFloodWait", () => {
  it("ignora linhas que não estão pending", () => {
    const r = earliestFloodWait([
      { status: "sent", error_message: "flood_wait_60s", scheduled_at: "2026-09-10T09:00:00-03:00" },
      { status: "failed", error_message: "flood_wait_60s", scheduled_at: "2026-09-10T09:00:00-03:00" },
    ]);
    expect(r).toBeNull();
  });

  it("escolhe a espera que retoma primeiro entre várias pendentes", () => {
    const r = earliestFloodWait([
      {
        status: "pending",
        error_message: "flood_wait_600s",
        scheduled_at: "2026-09-10T14:00:00-03:00",
      },
      {
        status: "pending",
        error_message: "flood_wait_60s",
        scheduled_at: "2026-09-10T09:05:00-03:00",
      },
      { status: "pending", error_message: null, scheduled_at: "2026-09-10T09:10:00-03:00" },
    ]);
    expect(r?.resumesAt).toEqual(new Date("2026-09-10T09:05:00-03:00"));
  });

  it("campanha sem flood em curso devolve null", () => {
    const r = earliestFloodWait([
      { status: "pending", error_message: null, scheduled_at: "2026-09-10T09:00:00-03:00" },
      { status: "sent", error_message: null, scheduled_at: null },
    ]);
    expect(r).toBeNull();
  });
});
