import { describe, it, expect } from "vitest";
import { hashSlug, generateSlug, slugMatches, evaluateSlugGate } from "@/lib/traffic-filter/slug";

describe("Portão de slug (chave de segurança final)", () => {
  it("hashSlug é determinístico e ignora espaços nas pontas", () => {
    expect(hashSlug("abc123")).toBe(hashSlug("  abc123  "));
    expect(hashSlug("abc123")).not.toBe(hashSlug("abc124"));
    expect(hashSlug("x")).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it("generateSlug: comprimento certo, charset url-safe sem ambíguos", () => {
    const s = generateSlug(8);
    expect(s).toHaveLength(8);
    expect(s).toMatch(/^[a-z2-9]+$/); // sem l/o/0/1
  });

  it("slugMatches: bate só com o slug certo", () => {
    const hash = hashSlug("k7m2x9ab");
    expect(slugMatches("k7m2x9ab", hash)).toBe(true);
    expect(slugMatches("errado", hash)).toBe(false);
    expect(slugMatches(null, hash)).toBe(false);
    expect(slugMatches("k7m2x9ab", null)).toBe(false);
  });

  it("evaluateSlugGate: desligado nunca interfere", () => {
    expect(evaluateSlugGate(false, null, null)).toBe("pass");
    expect(evaluateSlugGate(false, hashSlug("a"), "qualquer")).toBe("pass");
  });

  it("evaluateSlugGate: ligado exige o slug certo", () => {
    const hash = hashSlug("segredo42");
    expect(evaluateSlugGate(true, hash, "segredo42")).toBe("pass");  // certo → passa
    expect(evaluateSlugGate(true, hash, "chuteforjado")).toBe("block"); // errado → block
    expect(evaluateSlugGate(true, hash, null)).toBe("block");          // ausente → block
    expect(evaluateSlugGate(true, null, "segredo42")).toBe("block");   // sem hash salvo → block
  });
});
