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
});
