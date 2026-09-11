import { describe, expect, it } from "vitest";
import { extractLoginCode, LOGIN_CODE_LENGTH } from "../../src/webhook/mtproto-login-code.js";

describe("extrair o código de login do que a pessoa mandou", () => {
  it("aceita o código digitado sozinho", () => {
    expect(extractLoginCode("22347")).toBe("22347");
  });

  it("aceita com espaços ou traços entre os dígitos", () => {
    expect(extractLoginCode("2 2 3 4 7")).toBe("22347");
    expect(extractLoginCode("223-47")).toBe("22347");
    expect(extractLoginCode("  22347  ")).toBe("22347");
  });

  it("aceita a mensagem oficial do Telegram encaminhada", () => {
    expect(
      extractLoginCode("Login code: 22347. Do not give this code to anyone, even if they say they are from Telegram!"),
    ).toBe("22347");
  });

  // O defeito relatado: juntar TODOS os dígitos da mensagem fazia
  // "22347" + "2" virar 6 dígitos, e o código era recusado aqui, sem nunca
  // chegar ao Telegram. Pelo teclado isso não acontecia — daí a assimetria.
  it("ignora outros números no meio do texto", () => {
    expect(extractLoginCode("Código de login: 22347. O código expira em 2 minutos.")).toBe("22347");
    expect(extractLoginCode("Seu código é 22347 (válido por 5 min)")).toBe("22347");
  });

  it("não confunde o código com um número de telefone", () => {
    expect(extractLoginCode("+5511999999999")).toBeNull();
  });

  it("não recorta um pedaço de uma sequência maior de dígitos", () => {
    expect(extractLoginCode("12345678")).toBeNull();
  });

  // Enviar o código errado queima o código verdadeiro e força um novo ciclo.
  // Na dúvida é melhor pedir de novo do que chutar.
  it("recusa quando há mais de um candidato diferente", () => {
    expect(extractLoginCode("11111 ou 22222")).toBeNull();
  });

  it("aceita quando o mesmo código aparece repetido", () => {
    expect(extractLoginCode("22347 22347")).toBe("22347");
  });

  it("recusa texto sem código nenhum", () => {
    expect(extractLoginCode("oi, não recebi nada")).toBeNull();
    expect(extractLoginCode("")).toBeNull();
    expect(extractLoginCode("   ")).toBeNull();
  });

  it("recusa um código de tamanho diferente do que o Telegram pediu", () => {
    expect(extractLoginCode("2234")).toBeNull();
    expect(extractLoginCode("223470")).toBeNull();
  });

  it("respeita um tamanho diferente quando informado", () => {
    expect(extractLoginCode("223470", 6)).toBe("223470");
    expect(extractLoginCode("Login code: 223470", 6)).toBe("223470");
  });

  it("expõe o tamanho usado pelo teclado, para os dois caminhos não divergirem", () => {
    expect(LOGIN_CODE_LENGTH).toBe(5);
  });
});
