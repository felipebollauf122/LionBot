import { describe, it, expect } from "vitest";
import { evaluateRules, ipMatches, type TrafficSignals } from "@/lib/traffic-filter/match";
import type { TrafficFilterRule } from "@/lib/types/database";

function rule(p: Partial<TrafficFilterRule>): TrafficFilterRule {
  return {
    id: "r", tenant_id: "t", list: "block", match_type: "ip",
    value: "", note: null, rule_kind: "custom", is_active: true, created_at: "2026-06-26T00:00:00Z",
    ...p,
  };
}

const realClick: TrafficSignals = {
  ip: "189.1.2.3", userAgent: "Mozilla/5.0 Chrome", referer: "https://l.facebook.com/",
  fbclid: "IwAR123", asn: "AS28573", isHosting: false,
};
const fbCrawler: TrafficSignals = {
  ip: "66.220.149.1", userAgent: "facebookexternalhit/1.1", referer: null,
  fbclid: null, asn: "AS32934", isHosting: true,
};
const spyNoFbclid: TrafficSignals = {
  ip: "203.0.113.9", userAgent: "Mozilla/5.0 Safari", referer: null,
  fbclid: null, asn: "AS15169", isHosting: false,
};

describe("evaluateRules — precedência", () => {
  it("ALLOW explícito vence BLOCK explícito", () => {
    const rules = [
      rule({ list: "block", match_type: "ip", value: "203.0.113.9" }),
      rule({ list: "allow", match_type: "ip", value: "203.0.113.9" }),
    ];
    expect(evaluateRules(spyNoFbclid, rules)).toBe("allow");
  });

  it("crawler FB com ALLOW user_agent vê allow mesmo sem fbclid e em hosting", () => {
    const rules = [rule({ list: "allow", match_type: "user_agent", value: "facebookexternalhit" })];
    expect(evaluateRules(fbCrawler, rules)).toBe("allow");
  });

  it("regra desativada é ignorada", () => {
    const rules = [rule({ list: "allow", match_type: "ip", value: "203.0.113.9", is_active: false })];
    expect(evaluateRules(spyNoFbclid, rules)).toBe("block"); // cai no default (sem fbclid)
  });
});

describe("evaluateRules — default por sinal (sem regras)", () => {
  it("clique real com fbclid → allow", () => {
    expect(evaluateRules(realClick, [])).toBe("allow");
  });
  it("humano sem fbclid → block", () => {
    expect(evaluateRules(spyNoFbclid, [])).toBe("block");
  });
  it("hosting/datacenter → block", () => {
    const s = { ...realClick, fbclid: null, isHosting: true };
    expect(evaluateRules(s, [])).toBe("block");
  });
  it("referer da Ad Library → block (mesmo coisa estranha no fbclid vazio)", () => {
    const s: TrafficSignals = { ...spyNoFbclid, referer: "https://www.facebook.com/ads/library/?id=1" };
    expect(evaluateRules(s, [])).toBe("block");
  });
});

describe("evaluateRules — match types", () => {
  it("block por referer (substring)", () => {
    const rules = [rule({ list: "block", match_type: "referer", value: "ads/library" })];
    const s = { ...realClick, referer: "https://www.facebook.com/ads/library/?q=x" };
    expect(evaluateRules(s, rules)).toBe("block");
  });
  it("block por asn exato", () => {
    const rules = [rule({ list: "block", match_type: "asn", value: "AS15169" })];
    expect(evaluateRules({ ...realClick, asn: "AS15169" }, rules)).toBe("block");
  });
  it("block por user_agent (substring, case-insensitive)", () => {
    const rules = [rule({ list: "block", match_type: "user_agent", value: "python-requests" })];
    const s = { ...realClick, userAgent: "python-requests/2.31" };
    expect(evaluateRules(s, rules)).toBe("block");
  });
});

describe("ipMatches", () => {
  it("casa IP exato", () => {
    expect(ipMatches("203.0.113.9", "203.0.113.9")).toBe(true);
    expect(ipMatches("203.0.113.9", "203.0.113.8")).toBe(false);
  });
  it("casa CIDR IPv4", () => {
    expect(ipMatches("203.0.113.0/24", "203.0.113.55")).toBe(true);
    expect(ipMatches("203.0.113.0/24", "203.0.114.1")).toBe(false);
  });
  it("ip nulo nunca casa", () => {
    expect(ipMatches("203.0.113.0/24", null)).toBe(false);
  });
});
