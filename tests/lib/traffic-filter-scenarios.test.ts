import { describe, it, expect } from "vitest";
import { evaluateRules, type TrafficSignals } from "@/lib/traffic-filter/match";
import type { TrafficFilterRule } from "@/lib/types/database";

/**
 * Cenários ponta-a-ponta (Task 10 do plano) sobre o veredito final.
 * Usa as SEEDS reais que a migration 043 cria: regras ALLOW do crawler do FB.
 * Garante o caso crítico anti-cloaking: o crawler revisor SEMPRE vê a /t real.
 */

// Seeds idênticas às da migration 043_traffic_filter_rules.sql.
const FB_CRAWLER_SEEDS: TrafficFilterRule[] = ["facebookexternalhit", "facebookcatalog", "meta-externalagent"].map(
  (value, i) => ({
    id: `seed-${i}`,
    tenant_id: "tenant-1",
    list: "allow",
    match_type: "user_agent",
    value,
    note: "crawler FB (anti-cloaking) — não remover",
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
      asn: "AS16509", // Amazon
      isHosting: true,
    };
    expect(evaluateRules(datacenterSpy, FB_CRAWLER_SEEDS)).toBe("block");
  });
});
