import { describe, it, expect } from "vitest";
import { isAuthorizedInternalRequest } from "../../src/services/mtproto/internal-auth.js";

describe("isAuthorizedInternalRequest", () => {
  it("segredo configurado e header batendo: autoriza", () => {
    expect(isAuthorizedInternalRequest("s3gredo", "s3gredo")).toBe(true);
  });

  it("header ausente: recusa", () => {
    expect(isAuthorizedInternalRequest("s3gredo", undefined)).toBe(false);
  });

  it("header errado: recusa", () => {
    expect(isAuthorizedInternalRequest("s3gredo", "outro")).toBe(false);
  });

  it("segredo NÃO configurado (vazio): recusa mesmo se o header vier vazio também", () => {
    // Endpoint não configurado não é "endpoint aberto" — não pode liberar só
    // porque ninguém setou nada dos dois lados.
    expect(isAuthorizedInternalRequest("", "")).toBe(false);
    expect(isAuthorizedInternalRequest("", undefined)).toBe(false);
  });

  it("header vindo como array (header duplicado): recusa, nunca compara frouxo", () => {
    expect(isAuthorizedInternalRequest("s3gredo", ["s3gredo", "s3gredo"])).toBe(false);
  });

  it("header do mesmo tamanho do segredo mas com conteúdo diferente: recusa (exercita o caminho timing-safe)", () => {
    // Mesmo comprimento do "s3gredo" (7 chars) — isto é o que força a
    // comparação a passar pelo timingSafeEqual em vez de só recusar pelo
    // comprimento, que é o caminho mais fácil de deixar passar por engano.
    expect(isAuthorizedInternalRequest("s3gredo", "s3gredx")).toBe(false);
  });

  it("header mais curto que o segredo: recusa sem lançar (buffers de tamanhos diferentes)", () => {
    expect(isAuthorizedInternalRequest("s3gredo", "s3g")).toBe(false);
  });

  it("header mais longo que o segredo: recusa sem lançar (buffers de tamanhos diferentes)", () => {
    expect(isAuthorizedInternalRequest("s3gredo", "s3gredo-e-mais-coisa")).toBe(false);
  });
});
