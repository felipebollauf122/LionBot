import { describe, it, expect } from "vitest";
import { groupMessages, GROUP_GAP_SECONDS } from "@/lib/social-proof/grouping";
import type { FeedMessage } from "@/lib/social-proof/types";

const now = new Date("2026-09-01T15:00:00-03:00");

function msg(id: string, senderName: string, offsetSeconds: number): FeedMessage {
  return {
    id,
    senderKind: "member",
    senderName,
    senderAvatarUrl: null,
    kind: "text",
    contentText: `texto ${id}`,
    media: [],
    reactions: [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds,
    displayTime: null,
    viewsCount: 0,
  };
}

/** Atalho de leitura: "FL" = primeira e última, "F." = só primeira, etc. */
function shape(messages: FeedMessage[]): string[] {
  return groupMessages(messages, now).map(
    (m) => `${m.isFirstOfGroup ? "F" : "."}${m.isLastOfGroup ? "L" : "."}`,
  );
}

describe("groupMessages", () => {
  it("lista vazia devolve lista vazia", () => {
    expect(groupMessages([], now)).toEqual([]);
  });

  it("mensagem única é primeira e última do próprio grupo", () => {
    expect(shape([msg("a", "Ana", 600)])).toEqual(["FL"]);
  });

  it("duas do mesmo remetente formam um grupo só", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", "Ana", 580)])).toEqual(["F.", ".L"]);
  });

  it("três do mesmo remetente: só a do meio não é nem primeira nem última", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", "Ana", 580), msg("c", "Ana", 560)])).toEqual([
      "F.",
      "..",
      ".L",
    ]);
  });

  it("remetentes alternados: cada mensagem é seu próprio grupo", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", "Bia", 580), msg("c", "Ana", 560)])).toEqual([
      "FL",
      "FL",
      "FL",
    ]);
  });

  it("mesmo remetente não-adjacente não junta com o grupo anterior", () => {
    const out = groupMessages(
      [msg("a", "Ana", 600), msg("b", "Bia", 580), msg("c", "Ana", 560), msg("d", "Ana", 540)],
      now,
    );
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true, true, false]);
    expect(out.map((m) => m.isLastOfGroup)).toEqual([true, true, false, true]);
  });

  it("quebra o grupo quando o intervalo passa do limite", () => {
    // Mesmo remetente, mas com uma hora de distância: o Telegram separa.
    const distante = GROUP_GAP_SECONDS + 60;
    expect(shape([msg("a", "Ana", 3600), msg("b", "Ana", 3600 - distante)])).toEqual(["FL", "FL"]);
  });

  it("não quebra quando o intervalo está dentro do limite", () => {
    const perto = GROUP_GAP_SECONDS - 60;
    expect(shape([msg("a", "Ana", 3600), msg("b", "Ana", 3600 - perto)])).toEqual(["F.", ".L"]);
  });

  it("offsets fora de ordem não fundem grupos por acidente", () => {
    // O tenant pode reordenar por `position` e deixar offsets inconsistentes.
    // Distância é medida em módulo, então isso quebra o grupo em vez de
    // produzir um agrupamento silenciosamente errado.
    expect(shape([msg("a", "Ana", 100), msg("b", "Ana", 9000)])).toEqual(["FL", "FL"]);
  });

  it("resolve a data absoluta de cada mensagem", () => {
    const [m] = groupMessages([msg("a", "Ana", 900)], now);
    expect(m.at.toISOString()).toBe(new Date("2026-09-01T14:45:00-03:00").toISOString());
  });

  it("preserva a ordem e o conteúdo original", () => {
    const input = [msg("a", "Ana", 600), msg("b", "Bia", 580)];
    const out = groupMessages(input, now);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[0].contentText).toBe("texto a");
  });

  it("nomes que diferem só por espaço em volta contam como o mesmo remetente", () => {
    expect(shape([msg("a", "Ana", 600), msg("b", " Ana ", 580)])).toEqual(["F.", ".L"]);
  });
});

describe("groupMessages — identidade da dona", () => {
  function dona(id: string, senderName: string, offsetSeconds: number): FeedMessage {
    return { ...msg(id, senderName, offsetSeconds), senderKind: "owner" };
  }

  it("duas mensagens seguidas da dona agrupam mesmo com senderName diferente", () => {
    // A dona tira identidade do canal; o senderName da mensagem é ignorado na
    // renderização, então não pode separar grupos.
    const out = groupMessages([dona("a", "", 600), dona("b", "sobra antiga", 580)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, false]);
    expect(out.map((m) => m.isLastOfGroup)).toEqual([false, true]);
  });

  it("dona e membro com o MESMO nome não agrupam", () => {
    // Senão um avatar só cobriria dois remetentes que a tela mostra diferentes.
    const out = groupMessages([dona("a", "Ana", 600), msg("b", "Ana", 580)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true]);
    expect(out.map((m) => m.isLastOfGroup)).toEqual([true, true]);
  });

  it("membro e dona alternando: cada um é seu próprio grupo", () => {
    const out = groupMessages([msg("a", "Ana", 600), dona("b", "", 580), msg("c", "Ana", 560)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true, true]);
  });

  it("a janela de tempo continua valendo para a dona", () => {
    const out = groupMessages([dona("a", "", 3600), dona("b", "", 3600 - 960)], now);
    expect(out.map((m) => m.isFirstOfGroup)).toEqual([true, true]);
  });
});
