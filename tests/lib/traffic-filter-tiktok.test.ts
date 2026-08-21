import { describe, it, expect } from "vitest";
import { evaluateRules, isLikelyRealTtclid, type TrafficSignals } from "@/lib/traffic-filter/match";
import type { TrafficFilterRule } from "@/lib/types/database";

/**
 * Clique pago do TikTok na /t. O bug real: o anúncio do TikTok Ads chega com
 * ?ttclid=... e SEM fbclid — o evaluateRules só olhava fbclid, então o
 * comprador caía no blockSpies e via a LionBotSalesPage (0% de conversão pra
 * qualquer bot com traffic_filter_enabled + pixel do TikTok).
 */

// Seeds idênticas às da migration 043/044 (crawler do FB em ALLOW), pra provar
// que o caminho do TikTok convive com o filtro já em produção.
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

// Todas as categorias ligadas — o cenário que hoje derruba o clique do TikTok.
const ALL_ON = { blockSpies: true, blockDatacenter: true, blockAdLibrary: true, blockFbCrawler: false };

// ttclid real de campanha (formato observado: prefixo `E.C.P.` + ~300 chars
// base64-url com pontos). É o valor que o TikTok anexa no link do anúncio.
const REAL_TTCLID =
  "E.C.P.CtEBlgHH9VeLnVpbmeJC9Ij-5Vau9oaS_oFMuHg5LpI5iEf7pH_LVMzrECCZ93sObhqdspcZ1LeXkvoTgcIB9yGX7w" +
  "FyHH31Wrwdcu6w3GRppR-zbxEdfk43J8lg4LY7ZVH-BopVJnj-oYwo7IOaPmFUnr5O4RqsbCNKDsud-BNBdjTS4wyn_tb2SG" +
  "69MqrYwhbXYUX-gNuxsOyXrApEktieqPYNdI03DynLfTNQ6JKUzzvLLurBfvoM8kKO9iYAjg7z7zfy043fSHAj7dnsWICrFQ";

// A MESMA campanha também emite o prefixo com underscore em vez de ponto
// (`E_C_P_`) — as duas formas aparecem em tráfego real. Fica coberta pra que
// um aperto futuro no charset (ex: alguém tirar o '_' do regex) não derrube
// silenciosamente metade dos cliques pagos do TikTok.
const REAL_TTCLID_UNDERSCORE =
  "E_C_P_CswBggGYoLSb2OWWs7d6_dCSRMT0lOLEMv4P4x76blU8jr6mTtbcKypY025wxIXt3n232wq__CyBbu9cIGua4Jazcb69" +
  "ZzABJ2jK93F4NyT44uKuUCKF8ghAeaiktdWS01TnRZRQOpJDuJf0zMQhzxUXbfG-GPH8B77njCAfNOEE12OUcNbVGP9qNQ24zh" +
  "pH-dUEa0DSlIbUojRrbC57e4oE4pJ7vCgz13xUvPwfNTmf70MIBjRLIlWW6arL0Id8rAQFSwUZ8FkowgAUbTdSEgR2Mi4wGiCM";

// Espião no browser dele: cola um ttclid aleatório na URL. 21 chars — passaria
// no piso de 20 do fbclid, e é exatamente isso que NÃO pode se repetir aqui.
const FORGED_TTCLID = "abc123XYZ_-9876543zzz";

const tiktokClick: TrafficSignals = {
  ip: "189.40.1.2",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 BytedanceWebview/d8a21c",
  referer: null, // webview in-app do TikTok costuma abrir SEM referer
  fbclid: null,
  ttclid: REAL_TTCLID,
  asn: "AS28573",
  isHosting: false,
};

describe("clique pago do TikTok (?ttclid=) no filtro de tráfego", () => {
  it("clique real do TikTok (só ttclid, sem fbclid, sem referer) → allow com blockSpies LIGADO", () => {
    // Regressão do bug: antes caía no `if (categories.blockSpies) return "block"`.
    expect(evaluateRules(tiktokClick, FB_CRAWLER_SEEDS, ALL_ON)).toBe("allow");
    expect(evaluateRules(tiktokClick, FB_CRAWLER_SEEDS)).toBe("allow"); // default = tudo ligado
  });

  it("ttclid forjado/curto sem referer → block (não repete o furo de 20 chars do fbclid)", () => {
    const forged: TrafficSignals = { ...tiktokClick, ttclid: FORGED_TTCLID };
    expect(evaluateRules(forged, FB_CRAWLER_SEEDS, ALL_ON)).toBe("block");
    // ?ttclid=teste, o forjado mais óbvio de todos:
    expect(evaluateRules({ ...tiktokClick, ttclid: "teste" }, FB_CRAWLER_SEEDS, ALL_ON)).toBe("block");
  });

  it("ttclid curto MAS com referer do TikTok → allow (o referer é a corroboração)", () => {
    const withReferer: TrafficSignals = {
      ...tiktokClick,
      ttclid: FORGED_TTCLID,
      referer: "https://www.tiktok.com/",
    };
    expect(evaluateRules(withReferer, FB_CRAWLER_SEEDS, ALL_ON)).toBe("allow");
  });

  it("regra BLOCK explícita ainda vence o clique do TikTok (precedência intacta)", () => {
    const rules: TrafficFilterRule[] = [
      ...FB_CRAWLER_SEEDS,
      {
        id: "b1", tenant_id: "tenant-1", list: "block", match_type: "ip", value: "189.40.1.2",
        note: null, rule_kind: "custom", is_active: true, created_at: "2026-06-26T00:00:00Z",
      },
    ];
    expect(evaluateRules(tiktokClick, rules, ALL_ON)).toBe("block");
  });

  it("robô do FB com ttclid colado ainda obedece a flag do crawler (cloaking intacto)", () => {
    // O check do crawler roda ANTES do par fbclid/ttclid: um revisor do FB que
    // chegue com ttclid na URL não pode virar passe livre quando o usuário
    // ligou o cloaking, nem ser bloqueado quando desligou.
    const crawlerWithTtclid: TrafficSignals = {
      ...tiktokClick,
      userAgent: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    };
    expect(
      evaluateRules(crawlerWithTtclid, FB_CRAWLER_SEEDS, { ...ALL_ON, blockFbCrawler: true }),
    ).toBe("block");
    expect(evaluateRules(crawlerWithTtclid, FB_CRAWLER_SEEDS, ALL_ON)).toBe("allow");
  });
});

describe("isLikelyRealTtclid", () => {
  it("ttclid real passa sozinho (sem referer), nos dois prefixos observados", () => {
    expect(isLikelyRealTtclid(REAL_TTCLID, null)).toBe(true);
    expect(isLikelyRealTtclid(REAL_TTCLID_UNDERSCORE, null)).toBe(true);
  });

  it("ausente/vazio nunca passa", () => {
    expect(isLikelyRealTtclid(null, "https://www.tiktok.com/")).toBe(false);
    expect(isLikelyRealTtclid("   ", "https://www.tiktok.com/")).toBe(false);
  });

  it("charset fora do base64-url+ponto não passa nem sendo longo", () => {
    const bogus = "a".repeat(60) + "!<script>";
    expect(isLikelyRealTtclid(bogus, null)).toBe(false);
    expect(isLikelyRealTtclid(bogus, "https://www.tiktok.com/")).toBe(false);
  });

  it("piso de comprimento sozinho: 49 não passa, 50 passa", () => {
    expect(isLikelyRealTtclid("a".repeat(49), null)).toBe(false);
    expect(isLikelyRealTtclid("a".repeat(50), null)).toBe(true);
  });

  it("reconhece os domínios do TikTok no referer", () => {
    const short = "a".repeat(20);
    for (const ref of [
      "https://www.tiktok.com/@perfil",
      "https://m.tiktok.com/",
      "https://ttwid.bytedance.com/",
      "https://www.musical.ly/",
    ]) {
      expect(isLikelyRealTtclid(short, ref)).toBe(true);
    }
    // referer de outro lugar não corrobora nada:
    expect(isLikelyRealTtclid(short, "https://www.google.com/")).toBe(false);
  });
});

describe("regressão: o caminho do fbclid não mudou", () => {
  const base: TrafficSignals = {
    ip: "189.40.1.9",
    userAgent: "Mozilla/5.0 (iPhone) Safari",
    referer: null,
    fbclid: null,
    ttclid: null,
    asn: "AS28573",
    isHosting: false,
  };

  it("fbclid plausível sem referer → allow (igual antes)", () => {
    expect(
      evaluateRules({ ...base, fbclid: "IwAR1aBcD2eFgH3iJkL4mNoP5qRsT6uVwX7yZ" }, FB_CRAWLER_SEEDS, ALL_ON),
    ).toBe("allow");
  });

  it("fbclid curto com referer do FB → allow (igual antes)", () => {
    expect(
      evaluateRules({ ...base, fbclid: "x9", referer: "https://l.facebook.com/" }, FB_CRAWLER_SEEDS, ALL_ON),
    ).toBe("allow");
  });

  it("fbclid forjado sem referer → block (igual antes)", () => {
    expect(evaluateRules({ ...base, fbclid: "teste" }, FB_CRAWLER_SEEDS, ALL_ON)).toBe("block");
  });

  it("espião sem fbclid E sem ttclid → block (igual antes)", () => {
    expect(evaluateRules(base, FB_CRAWLER_SEEDS, ALL_ON)).toBe("block");
  });
});
