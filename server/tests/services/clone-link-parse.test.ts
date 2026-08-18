import { describe, it, expect } from "vitest";
import { parseLinkIdentifier } from "../../src/services/mtproto/link-parse.js";

describe("parseLinkIdentifier", () => {
  it("mention @username", () => {
    expect(parseLinkIdentifier("@meubot")).toEqual({ kind: "username", value: "meubot" });
  });

  it("t.me/username sem protocolo", () => {
    expect(parseLinkIdentifier("t.me/meucanal")).toEqual({ kind: "username", value: "meucanal" });
  });

  it("https://t.me/username", () => {
    expect(parseLinkIdentifier("https://t.me/meucanal")).toEqual({
      kind: "username",
      value: "meucanal",
    });
  });

  it("http://t.me/username", () => {
    expect(parseLinkIdentifier("http://t.me/meucanal")).toEqual({
      kind: "username",
      value: "meucanal",
    });
  });

  it("telegram.me/username", () => {
    expect(parseLinkIdentifier("telegram.me/meucanal")).toEqual({
      kind: "username",
      value: "meucanal",
    });
  });

  it("www.t.me/username", () => {
    expect(parseLinkIdentifier("https://www.t.me/meucanal")).toEqual({
      kind: "username",
      value: "meucanal",
    });
  });

  it("tira query string (deep link de bot)", () => {
    expect(parseLinkIdentifier("t.me/meubot?start=xyz")).toEqual({
      kind: "username",
      value: "meubot",
    });
  });

  it("tira barra final", () => {
    expect(parseLinkIdentifier("t.me/meucanal/")).toEqual({ kind: "username", value: "meucanal" });
  });

  it("t.me/+hash vira invite — gap real do parser embutido do gramjs", () => {
    expect(parseLinkIdentifier("t.me/+AbC123hash")).toEqual({ kind: "invite", hash: "AbC123hash" });
  });

  it("https://t.me/joinchat/hash vira invite (formato legado)", () => {
    expect(parseLinkIdentifier("https://t.me/joinchat/AbC123hash")).toEqual({
      kind: "invite",
      hash: "AbC123hash",
    });
  });

  it("t.me/@user vira username, NÃO invite — corrige o bug do parser do gramjs", () => {
    expect(parseLinkIdentifier("t.me/@meucanal")).toEqual({ kind: "username", value: "meucanal" });
  });

  it("URL não-Telegram vira null", () => {
    expect(parseLinkIdentifier("https://outrosite.com/pagina")).toBeNull();
  });

  it("t.me bare (sem barra) vira null", () => {
    expect(parseLinkIdentifier("t.me")).toBeNull();
  });

  it("t.me/ (remanescente vazio) vira null", () => {
    expect(parseLinkIdentifier("t.me/")).toBeNull();
  });

  it("t.me/s/canal (link de preview) vira null, sem gastar RPC", () => {
    expect(parseLinkIdentifier("t.me/s/meucanal")).toBeNull();
  });

  it("t.me/c/123/456 (deep link interno) vira null", () => {
    expect(parseLinkIdentifier("t.me/c/123/456")).toBeNull();
  });

  it("t.me/user/123 (link de mensagem específica) vira null", () => {
    expect(parseLinkIdentifier("t.me/meucanal/123")).toBeNull();
  });

  it("string vazia ou só espaço vira null", () => {
    expect(parseLinkIdentifier("")).toBeNull();
    expect(parseLinkIdentifier("   ")).toBeNull();
  });

  it("@ sozinho vira null", () => {
    expect(parseLinkIdentifier("@")).toBeNull();
  });
});
