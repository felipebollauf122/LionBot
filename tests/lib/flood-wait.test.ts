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
  it("nomeia o Telegram como origem do limite e diz quando volta, sem o termo técnico", () => {
    const texto = describeFloodWait({
      waitSeconds: 300,
      resumesAt: new Date("2026-09-10T12:05:00-03:00"),
    });
    expect(texto).toContain("Telegram");
    expect(texto).toContain("12:05");
    // Escrito pra quem não sabe o que é "flood wait" — a string crua do
    // banco não pode vazar pro texto amigável.
    expect(texto.toLowerCase()).not.toContain("flood");
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
