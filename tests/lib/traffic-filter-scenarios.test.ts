import { describe, it, expect } from "vitest";
import { evaluateRules, type TrafficSignals } from "@/lib/traffic-filter/match";
import type { TrafficFilterRule } from "@/lib/types/database";

/**
 * Cenários ponta-a-ponta (Task 10 do plano) sobre o veredito final.
 * Usa as SEEDS reais que a migration 043 cria: regras ALLOW do crawler do FB.
 * Garante o caso crítico anti-cloaking: o crawler revisor SEMPRE vê a /t real.
 */

// Seeds idênticas às da migration 043/044: crawler do FB em ALLOW, classe fb_crawler.
const FB_CRAWLER_SEEDS: TrafficFilterRule[] = ["facebookexternalhit", "facebookcatalog", "meta-externalagent"].map(
  (value, i) => ({
    id: `seed-${i}`,
    tenant_id: "tenant-1",
    list: "allow",
    match_type: "user_agent",
    value,
    note: "crawler FB (anti-cloaking) — não remover",
    rule_kind: "fb_crawler",
    is_active: true,
    created_at: "2026-06-26T00:00:00Z",
  }),
);

describe("Cenários E2E do filtro de tráfego (com seeds do crawler FB)", () => {
  it("1. clique real de anúncio (com fbclid) → allow (vê a oferta)", () => {
    const realClick: TrafficSignals = {
      ip: "189.40.1.2",
      userAgent: "Mozilla/5.0 (iPhone) Safari",
      referer: "https://l.facebook.com/",
      fbclid: "IwAR_real_click_123",
      ttclid: null,
      asn: "AS28573",
      isHosting: false,
    };
    expect(evaluateRules(realClick, FB_CRAWLER_SEEDS)).toBe("allow");
  });

  it("2. crawler do FB (facebookexternalhit, sem fbclid, em datacenter) → allow — ANTI-CLOAKING", () => {
    const fbCrawler: TrafficSignals = {
      ip: "66.220.149.99",
      userAgent: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS32934", // Facebook
      isHosting: true,
    };
    // Mesmo sem fbclid e em hosting (que normalmente = block), a seed ALLOW
    // do user_agent intercepta ANTES do default-por-sinal. O anúncio aprova.
    expect(evaluateRules(fbCrawler, FB_CRAWLER_SEEDS)).toBe("allow");
  });

  it("3. espião humano sem fbclid (browser real) → block (cai na landing de venda)", () => {
    const humanSpy: TrafficSignals = {
      ip: "200.150.10.20",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS27699",
      isHosting: false,
    };
    expect(evaluateRules(humanSpy, FB_CRAWLER_SEEDS)).toBe("block");
  });

  it("4. espião vindo da Ad Library → block", () => {
    const adLibrarySpy: TrafficSignals = {
      ip: "200.150.10.21",
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/124",
      referer: "https://www.facebook.com/ads/library/?id=99999",
      fbclid: null,
      ttclid: null,
      asn: "AS27699",
      isHosting: false,
    };
    expect(evaluateRules(adLibrarySpy, FB_CRAWLER_SEEDS)).toBe("block");
  });

  it("5. espião de datacenter/VPN (mesmo com fbclid forjado ausente) → block", () => {
    const datacenterSpy: TrafficSignals = {
      ip: "203.0.113.50",
      userAgent: "Mozilla/5.0 (X11; Linux) HeadlessChrome/124",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS16509", // Amazon
      isHosting: true,
    };
    expect(evaluateRules(datacenterSpy, FB_CRAWLER_SEEDS)).toBe("block");
  });

  it("7. categoria 'bloquear espiões' DESLIGADA → espião humano passa (allow)", () => {
    const humanSpy: TrafficSignals = {
      ip: "200.150.10.20",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS27699",
      isHosting: false,
    };
    // Com a categoria de espiões desligada (e sem datacenter/adlibrary casando),
    // o espião humano deixa de ser bloqueado.
    const verdict = evaluateRules(humanSpy, FB_CRAWLER_SEEDS, {
      blockSpies: false,
      blockDatacenter: true,
      blockAdLibrary: true,
      blockFbCrawler: false,
      blockTiktokCrawler: false,
    });
    expect(verdict).toBe("allow");
  });

  it("8. categoria 'bloquear datacenter' DESLIGADA → VPN passa, mas espião ainda bloqueia", () => {
    const datacenter: TrafficSignals = {
      ip: "203.0.113.50",
      userAgent: "Mozilla/5.0 (X11; Linux) HeadlessChrome/124",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS16509",
      isHosting: true,
    };
    // datacenter desligado, mas blockSpies ligado → ainda cai como espião sem fbclid.
    expect(
      evaluateRules(datacenter, FB_CRAWLER_SEEDS, { blockSpies: true, blockDatacenter: false, blockAdLibrary: true, blockFbCrawler: false, blockTiktokCrawler: false }),
    ).toBe("block");
    // datacenter E espiões desligados → passa.
    expect(
      evaluateRules(datacenter, FB_CRAWLER_SEEDS, { blockSpies: false, blockDatacenter: false, blockAdLibrary: true, blockFbCrawler: false, blockTiktokCrawler: false }),
    ).toBe("allow");
  });

  it("9. crawler do FB com a CHAVE de bloqueio — desligada=allow, ligada=block (sem depender de seed)", () => {
    const fbCrawler: TrafficSignals = {
      ip: "66.220.149.99",
      userAgent: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS32934",
      isHosting: true,
    };
    // SEM nenhuma regra no banco — a classe é decidida só pela flag.
    // Chave desligada (padrão) → o crawler vê a página real.
    expect(
      evaluateRules(fbCrawler, [], { blockSpies: true, blockDatacenter: true, blockAdLibrary: true, blockFbCrawler: false, blockTiktokCrawler: false }),
    ).toBe("allow");
    // Chave ligada → o crawler é bloqueado (cloaking), mesmo com blockSpies ligado.
    expect(
      evaluateRules(fbCrawler, [], { blockSpies: true, blockDatacenter: true, blockAdLibrary: true, blockFbCrawler: true, blockTiktokCrawler: false }),
    ).toBe("block");
    // Vale pros 3 user-agents da classe:
    for (const ua of ["facebookcatalog/1.0", "meta-externalagent/1.1"]) {
      expect(
        evaluateRules({ ...fbCrawler, userAgent: ua }, [], { blockSpies: true, blockDatacenter: true, blockAdLibrary: true, blockFbCrawler: true, blockTiktokCrawler: false }),
      ).toBe("block");
    }
  });

  it("6. a FLAG é a autoridade sobre o crawler — vence até uma seed ALLOW no banco", () => {
    // Regressão do bug real: a seed ALLOW do crawler (migrations 043/044) NÃO
    // pode mais sobrepor a flag. Com blockFbCrawler=true, o crawler é bloqueado
    // mesmo existindo a regra allow no banco (isFbCrawler roda ANTES das regras).
    const fbCrawler: TrafficSignals = {
      ip: "66.220.149.99",
      userAgent: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS32934",
      isHosting: true,
    };
    // FB_CRAWLER_SEEDS tem a regra ALLOW do crawler. Mesmo assim, flag ligada → block.
    expect(
      evaluateRules(fbCrawler, FB_CRAWLER_SEEDS, { blockSpies: true, blockDatacenter: true, blockAdLibrary: true, blockFbCrawler: true, blockTiktokCrawler: false }),
    ).toBe("block");
    // Flag desligada → allow (a seed nem importa mais).
    expect(
      evaluateRules(fbCrawler, FB_CRAWLER_SEEDS, { blockSpies: true, blockDatacenter: true, blockAdLibrary: true, blockFbCrawler: false, blockTiktokCrawler: false }),
    ).toBe("allow");
  });

  it("10. fbclid FORJADO (?fbclid=teste, sem referer do FB) → block (não engana mais)", () => {
    const forged: TrafficSignals = {
      ip: "200.150.10.30",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124",
      referer: null,            // não veio do facebook
      fbclid: "teste",          // forjado, formato implausível
      ttclid: null,
      asn: "AS27699",
      isHosting: false,
    };
    // Antes "tem fbclid = allow" deixava passar. Agora o formato implausível +
    // sem referer do FB → não conta como clique real → cai como espião.
    expect(evaluateRules(forged, FB_CRAWLER_SEEDS)).toBe("block");
  });

  it("11. fbclid real (formato plausível OU referer do FB) → allow", () => {
    const base: TrafficSignals = {
      ip: "189.40.1.9",
      userAgent: "Mozilla/5.0 (iPhone) Safari",
      referer: null,
      fbclid: null,
      ttclid: null,
      asn: "AS28573",
      isHosting: false,
    };
    // a) formato plausível (longo, charset base64-url), mesmo sem referer:
    expect(
      evaluateRules({ ...base, fbclid: "IwAR1aBcD2eFgH3iJkL4mNoP5qRsT6uVwX7yZ" }, FB_CRAWLER_SEEDS),
    ).toBe("allow");
    // b) fbclid curto MAS com referer do facebook → também vale:
    expect(
      evaluateRules({ ...base, fbclid: "x9", referer: "https://l.facebook.com/" }, FB_CRAWLER_SEEDS),
    ).toBe("allow");
  });
});
