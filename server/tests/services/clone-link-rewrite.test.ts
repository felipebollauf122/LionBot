import { describe, it, expect } from "vitest";
import { Api } from "telegram";
import {
  applyTextReplacements,
  applyTextUrlReplacements,
  type TextReplacement,
} from "../../src/services/mtproto/clone/link-rewrite.js";

function urlReplacement(text: string, needle: string, newText: string): TextReplacement {
  const offset = text.indexOf(needle);
  return {
    offset,
    length: needle.length,
    newText,
    buildEntity: (o, l) => new Api.MessageEntityUrl({ offset: o, length: l }),
  };
}

describe("applyTextReplacements", () => {
  it("zero replacements: devolve as MESMAS referências (grátis no caso comum)", () => {
    const text = "sem nada pra trocar aqui";
    const entities = [new Api.MessageEntityBold({ offset: 0, length: 3 })];
    const out = applyTextReplacements(text, entities, []);
    expect(out.text).toBe(text);
    expect(out.entities).toBe(entities);
  });

  it("uma substituição do mesmo tamanho: entidades antes/depois ficam intactas", () => {
    const text = "Fale com @oldbot agora.";
    const before = new Api.MessageEntityBold({ offset: 0, length: 4 }); // "Fale"
    const mention = urlReplacement(text, "@oldbot", "@newbot"); // mesmo tamanho (7)
    const mentionEntity = new Api.MessageEntityMention({
      offset: mention.offset,
      length: mention.length,
    });
    const out = applyTextReplacements(text, [before, mentionEntity], [mention]);
    expect(out.text).toBe("Fale com @newbot agora.");
    // "Fale" não mexeu.
    expect(out.entities?.[0]).toMatchObject({ offset: 0, length: 4 });
    // A entidade substituída aponta pro texto novo.
    const replaced = out.entities?.[1] as Api.MessageEntityUrl;
    expect(out.text.slice(replaced.offset, replaced.offset + replaced.length)).toBe("@newbot");
  });

  it("substituição mais longa desloca entidade depois pra frente", () => {
    const text = "vai @bot e depois clique aqui.";
    const rest = new Api.MessageEntityBold({
      offset: text.indexOf("clique"),
      length: "clique aqui".length,
    });
    const restOriginalSlice = text.slice(rest.offset, rest.offset + rest.length);
    const r = urlReplacement(text, "@bot", "@umbotmuitomaislongo");
    const out = applyTextReplacements(text, [rest], [r]);
    const shifted = out.entities?.[0] as Api.MessageEntityBold;
    // Mesmo conteúdo, só que deslocado pela diferença de tamanho.
    expect(out.text.slice(shifted.offset, shifted.offset + shifted.length)).toBe(
      restOriginalSlice,
    );
    expect(shifted.offset).toBe(rest.offset + ("@umbotmuitomaislongo".length - "@bot".length));
  });

  it("substituição mais curta desloca entidade depois pra trás", () => {
    const text = "vai @umgrupocomnomelongo e depois clique aqui.";
    const rest = new Api.MessageEntityBold({
      offset: text.indexOf("clique"),
      length: "clique aqui".length,
    });
    const restOriginalSlice = text.slice(rest.offset, rest.offset + rest.length);
    const r = urlReplacement(text, "@umgrupocomnomelongo", "@g");
    const out = applyTextReplacements(text, [rest], [r]);
    const shifted = out.entities?.[0] as Api.MessageEntityBold;
    expect(out.text.slice(shifted.offset, shifted.offset + shifted.length)).toBe(
      restOriginalSlice,
    );
    expect(shifted.offset).toBeLessThan(rest.offset);
  });

  it("3 substituições de tamanhos variados numa mensagem só: deslocamento cumulativo correto", () => {
    const text = "@one meio1 @two meio2 @three fim.";
    const r1 = urlReplacement(text, "@one", "@1"); // delta -2
    const r2 = urlReplacement(text, "@two", "@dois-bem-mais-longo"); // delta +16
    const r3 = urlReplacement(text, "@three", "@3"); // delta -4

    // Entidade entre a 1ª e a 2ª substituição: só sofre o delta da 1ª.
    const between12 = new Api.MessageEntityItalic({
      offset: text.indexOf("meio1"),
      length: "meio1".length,
    });
    // Entidade entre a 2ª e a 3ª: sofre o delta acumulado de 1ª+2ª.
    const between23 = new Api.MessageEntityItalic({
      offset: text.indexOf("meio2"),
      length: "meio2".length,
    });
    // Entidade depois de tudo: sofre o delta acumulado das 3.
    const after = new Api.MessageEntityBold({ offset: text.indexOf("fim"), length: "fim".length });

    const originalSlices = [between12, between23, after].map((e) =>
      text.slice(e.offset, e.offset + e.length),
    );

    const out = applyTextReplacements(text, [between12, between23, after], [r1, r2, r3]);

    expect(out.text).toBe("@1 meio1 @dois-bem-mais-longo meio2 @3 fim.");
    const [outBetween12, outBetween23, outAfter] = out.entities as [
      Api.MessageEntityItalic,
      Api.MessageEntityItalic,
      Api.MessageEntityBold,
    ];
    // Conteúdo preservado em todas — só a posição muda.
    [outBetween12, outBetween23, outAfter].forEach((e, i) => {
      expect(out.text.slice(e.offset, e.offset + e.length)).toBe(originalSlices[i]);
    });
    // between12 só sofreu o delta de r1.
    expect(outBetween12.offset).toBe(between12.offset + ("@1".length - "@one".length));
    // between23 sofreu o delta de r1+r2.
    const delta12 = "@1".length - "@one".length + ("@dois-bem-mais-longo".length - "@two".length);
    expect(outBetween23.offset).toBe(between23.offset + delta12);
    // after sofreu o delta das 3.
    const delta123 = delta12 + ("@3".length - "@three".length);
    expect(outAfter.offset).toBe(after.offset + delta123);
  });

  it("formatação parcialmente sobreposta ao span trocado: clampa, nunca corrompe", () => {
    const text = "Fale com @oldbot agora.";
    // itálico cobre "com @ol" — começa antes do span de @oldbot e termina
    // estritamente DENTRO dele (nos 3 primeiros chars de "@oldbot").
    const italicStart = text.indexOf("com");
    const mentionOffset = text.indexOf("@oldbot");
    const italic = new Api.MessageEntityItalic({
      offset: italicStart,
      length: mentionOffset + 3 - italicStart,
    });
    const r = urlReplacement(text, "@oldbot", "@umbotnovo");

    const out = applyTextReplacements(text, [italic], [r]);
    const clamped = out.entities?.[0] as Api.MessageEntityItalic;

    // Início não mexeu (estava totalmente antes do span trocado).
    expect(clamped.offset).toBe(italicStart);
    // Fim clampou pro início do span trocado (mais perto do início do que
    // do fim do span original: 3 chars de distância do início, 4 do fim).
    expect(clamped.offset + clamped.length).toBe(mentionOffset);
    // Nunca deve incluir nada do texto novo — só o que já existia antes.
    expect(out.text.slice(clamped.offset, clamped.offset + clamped.length)).toBe("com ");
  });

  it("formatação inteiramente contida perto do início do span trocado colapsa e é descartada", () => {
    const text = "Fale com @oldbot agora.";
    const mentionOffset = text.indexOf("@oldbot");
    // negrito cobre só o "o" logo após o "@" — os dois boundaries clampam
    // pro mesmo edge (início), então vira comprimento zero.
    const tinyBold = new Api.MessageEntityBold({ offset: mentionOffset + 1, length: 1 });
    const r = urlReplacement(text, "@oldbot", "@umbotnovo");

    const out = applyTextReplacements(text, [tinyBold], [r]);

    expect(out.entities).toHaveLength(0);
  });

  it("descarta substituição que sobrepõe uma já aceita (guarda defensiva)", () => {
    const text = "@aa @bb";
    const r1: TextReplacement = {
      offset: text.indexOf("@aa"),
      length: 3,
      newText: "@x",
      buildEntity: (o, l) => new Api.MessageEntityUrl({ offset: o, length: l }),
    };
    // se sobrepõe (mesmo span de r1), é descartada — só r1 se aplica.
    const rOverlap: TextReplacement = { ...r1, newText: "@y" };
    const out = applyTextReplacements(text, [], [r1, rOverlap]);
    expect(out.text).toBe("@x @bb");
  });
});

describe("applyTextUrlReplacements", () => {
  it("zero replacements: devolve a MESMA referência do array", () => {
    const entities = [new Api.MessageEntityTextUrl({ offset: 0, length: 5, url: "https://a" })];
    expect(applyTextUrlReplacements(entities, [])).toBe(entities);
  });

  it("undefined entities: devolve undefined", () => {
    expect(applyTextUrlReplacements(undefined, [{ offset: 0, length: 5, newUrl: "x" }])).toBeUndefined();
  });

  it("troca só a .url, texto/offset/length do label ficam idênticos", () => {
    const original = new Api.MessageEntityTextUrl({
      offset: 6,
      length: 11,
      url: "https://t.me/canalvelho",
    });
    const out = applyTextUrlReplacements(
      [original],
      [{ offset: 6, length: 11, newUrl: "https://t.me/canalnovo" }],
    );
    const replaced = out?.[0] as Api.MessageEntityTextUrl;
    expect(replaced.offset).toBe(6);
    expect(replaced.length).toBe(11);
    expect(replaced.url).toBe("https://t.me/canalnovo");
  });

  it("não mexe em entidade que não é TextUrl", () => {
    const bold = new Api.MessageEntityBold({ offset: 0, length: 5 });
    const out = applyTextUrlReplacements([bold], [{ offset: 0, length: 5, newUrl: "https://x" }]);
    expect(out?.[0]).toBe(bold);
  });

  it("não mexe em TextUrl sem substituição correspondente (offset/length não bate)", () => {
    const textUrl = new Api.MessageEntityTextUrl({ offset: 0, length: 5, url: "https://a" });
    const out = applyTextUrlReplacements([textUrl], [{ offset: 99, length: 1, newUrl: "https://x" }]);
    expect(out?.[0]).toBe(textUrl);
  });
});
