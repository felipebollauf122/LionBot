import { describe, it, expect } from "vitest";
import { Api } from "telegram";
import {
  entitiesToHtml,
  gramjsEntitiesToCaptured,
  type CapturedEntity,
} from "../../src/services/mtproto/bot-clone/entities-to-html.js";

function span(text: string, needle: string) {
  return { offset: text.indexOf(needle), length: needle.length };
}

describe("gramjsEntitiesToCaptured", () => {
  it("converte cada tipo suportado pro shape plano", () => {
    const bold = new Api.MessageEntityBold({ offset: 0, length: 1 } as never);
    const textUrl = new Api.MessageEntityTextUrl({ offset: 2, length: 3, url: "https://a.com" } as never);
    const pre = new Api.MessageEntityPre({ offset: 6, length: 4, language: "js" } as never);
    const bq = new Api.MessageEntityBlockquote({ offset: 11, length: 5, collapsed: true } as never);

    expect(gramjsEntitiesToCaptured([bold, textUrl, pre, bq])).toEqual([
      { type: "bold", offset: 0, length: 1 },
      { type: "text_link", offset: 2, length: 3, url: "https://a.com" },
      { type: "pre", offset: 6, length: 4, language: "js" },
      { type: "blockquote", offset: 11, length: 5, collapsed: true },
    ]);
  });

  it("descarta tipo sem tag reconstruível (mention/custom emoji/etc) sem lançar", () => {
    const mention = new Api.MessageEntityMention({ offset: 0, length: 5 } as never);
    const customEmoji = new Api.MessageEntityCustomEmoji({ offset: 6, length: 2, documentId: 1n } as never);
    expect(gramjsEntitiesToCaptured([mention, customEmoji])).toEqual([]);
  });

  it("undefined vira array vazio", () => {
    expect(gramjsEntitiesToCaptured(undefined)).toEqual([]);
  });
});

describe("entitiesToHtml", () => {
  it("sem entities: só escapa o texto", () => {
    expect(entitiesToHtml("Tom & Jerry <3", undefined)).toBe("Tom &amp; Jerry &lt;3");
  });

  it("negrito vira <b>", () => {
    const text = "isso é importante!";
    const e: CapturedEntity = { type: "bold", ...span(text, "importante") };
    expect(entitiesToHtml(text, [e])).toBe("isso é <b>importante</b>!");
  });

  it("itálico vira <i>", () => {
    const text = "muito legal";
    const e: CapturedEntity = { type: "italic", ...span(text, "legal") };
    expect(entitiesToHtml(text, [e])).toBe("muito <i>legal</i>");
  });

  it("sublinhado vira <u>", () => {
    const text = "leia isso";
    const e: CapturedEntity = { type: "underline", ...span(text, "isso") };
    expect(entitiesToHtml(text, [e])).toBe("leia <u>isso</u>");
  });

  it("tachado vira <s>", () => {
    const text = "de R$100 por R$50";
    const e: CapturedEntity = { type: "strike", ...span(text, "R$100") };
    expect(entitiesToHtml(text, [e])).toBe("de <s>R$100</s> por R$50");
  });

  it('spoiler vira <span class="tg-spoiler">, NÃO <spoiler> (tag do gramjs não é Bot API válida)', () => {
    const text = "o final é surpreendente";
    const e: CapturedEntity = { type: "spoiler", ...span(text, "surpreendente") };
    expect(entitiesToHtml(text, [e])).toBe('o final é <span class="tg-spoiler">surpreendente</span>');
  });

  it("code vira <code>", () => {
    const text = "roda npm install";
    const e: CapturedEntity = { type: "code", ...span(text, "npm install") };
    expect(entitiesToHtml(text, [e])).toBe("roda <code>npm install</code>");
  });

  it("pre sem linguagem vira <pre>", () => {
    const text = "veja: bloco";
    const e: CapturedEntity = { type: "pre", ...span(text, "bloco") };
    expect(entitiesToHtml(text, [e])).toBe("veja: <pre>bloco</pre>");
  });

  it('pre com linguagem vira <pre><code class="language-X">', () => {
    const text = "veja: const x = 1";
    const e: CapturedEntity = { type: "pre", ...span(text, "const x = 1"), language: "js" };
    expect(entitiesToHtml(text, [e])).toBe('veja: <pre><code class="language-js">const x = 1</code></pre>');
  });

  it("text_link vira <a href>, com o texto visível preservado e a url escapada", () => {
    const text = "clique aqui";
    const e: CapturedEntity = { type: "text_link", ...span(text, "clique aqui"), url: 'https://a.com/"x"' };
    expect(entitiesToHtml(text, [e])).toBe('<a href="https://a.com/&quot;x&quot;">clique aqui</a>');
  });

  it("blockquote collapsed:true vira <blockquote expandable>", () => {
    const text = "trecho citado aqui";
    const e: CapturedEntity = { type: "blockquote", ...span(text, "trecho citado aqui"), collapsed: true };
    expect(entitiesToHtml(text, [e])).toBe("<blockquote expandable>trecho citado aqui</blockquote>");
  });

  it("blockquote sem collapsed vira <blockquote> simples", () => {
    const text = "trecho citado aqui";
    const e: CapturedEntity = { type: "blockquote", ...span(text, "trecho citado aqui") };
    expect(entitiesToHtml(text, [e])).toBe("<blockquote>trecho citado aqui</blockquote>");
  });

  it("entidades aninhadas (negrito dentro de itálico) produzem tags aninhadas corretamente", () => {
    const text = "isso é muito importante mesmo";
    const outer: CapturedEntity = { type: "italic", ...span(text, "muito importante") };
    const inner: CapturedEntity = { type: "bold", ...span(text, "importante") };
    expect(entitiesToHtml(text, [outer, inner])).toBe("isso é <i>muito <b>importante</b></i> mesmo");
  });

  it("duas entidades irmãs (não aninhadas) no mesmo texto", () => {
    const text = "vai @bot1 ou @bot2";
    const a: CapturedEntity = { type: "bold", ...span(text, "@bot1") };
    const b: CapturedEntity = { type: "italic", ...span(text, "@bot2") };
    expect(entitiesToHtml(text, [a, b])).toBe("vai <b>@bot1</b> ou <i>@bot2</i>");
  });

  it("texto fora e dentro da entidade tem & < > escapados", () => {
    const text = "Tom & Jerry: <b>rules</b>";
    const e: CapturedEntity = { type: "bold", ...span(text, "<b>rules</b>") };
    expect(entitiesToHtml(text, [e])).toBe("Tom &amp; Jerry: <b>&lt;b&gt;rules&lt;/b&gt;</b>");
  });

  it("array vazio: só escapa o texto, sem wrapping", () => {
    expect(entitiesToHtml("fale com @meubot agora", [])).toBe("fale com @meubot agora");
  });

  it("round-trip: entities capturadas do gramjs e serializadas via JSON continuam funcionando (prova o motivo da existência do shape plano)", () => {
    const text = "isso é importante";
    const raw = [new Api.MessageEntityBold(span(text, "importante") as never)];
    const captured = gramjsEntitiesToCaptured(raw);
    // Round-trip JSON — simula o que realmente acontece ao gravar em jsonb e
    // ler de volta: a instância do gramjs vira objeto plano de qualquer
    // forma; aqui é o shape plano que já é a fonte, então sobrevive intacto.
    const afterJson = JSON.parse(JSON.stringify(captured)) as CapturedEntity[];
    expect(entitiesToHtml(text, afterJson)).toBe("isso é <b>importante</b>");
  });
});
