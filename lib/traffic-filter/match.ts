import type { TrafficFilterRule } from "@/lib/types/database";

export interface TrafficSignals {
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  fbclid: string | null;
  asn: string | null;       // ex: "AS15169"
  isHosting: boolean;       // datacenter/proxy segundo ip-api
}

/** Casa um IP contra valor exato ou CIDR IPv4 (ex: "203.0.113.0/24"). */
export function ipMatches(ruleValue: string, ip: string | null): boolean {
  if (!ip) return false;
  const v = ruleValue.trim();
  if (!v.includes("/")) return v === ip;

  const [range, bitsStr] = v.split("/");
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const toInt = (s: string): number | null => {
    const parts = s.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      const o = Number(p);
      if (!Number.isInteger(o) || o < 0 || o > 255) return null;
      n = (n << 8) | o;
    }
    return n >>> 0;
  };

  const ipInt = toInt(ip);
  const rangeInt = toInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ruleMatches(rule: TrafficFilterRule, s: TrafficSignals): boolean {
  const val = rule.value.trim();
  if (!val) return false;
  switch (rule.match_type) {
    case "ip":
      return ipMatches(val, s.ip);
    case "asn":
      return !!s.asn && s.asn.toLowerCase() === val.toLowerCase();
    case "user_agent":
      return !!s.userAgent && s.userAgent.toLowerCase().includes(val.toLowerCase());
    case "referer":
      return !!s.referer && s.referer.toLowerCase().includes(val.toLowerCase());
    default:
      return false;
  }
}

/** Os 3 user-agents do robô revisor do Facebook (a "classe" do crawler). */
const FB_CRAWLER_UAS = ["facebookexternalhit", "facebookcatalog", "meta-externalagent"];

/** True se o User-Agent é de qualquer um dos 3 crawlers do Facebook. */
export function isFbCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return FB_CRAWLER_UAS.some((c) => ua.includes(c));
}

/**
 * Categorias do filtro (botões liga/desliga na UI). Cada flag liga/desliga um
 * pedaço do "default por sinal". Default = comportamento clássico.
 */
export interface TrafficCategories {
  blockSpies: boolean;       // humano sem fbclid (espião)
  blockDatacenter: boolean;  // IP de datacenter/VPN/proxy
  blockAdLibrary: boolean;   // veio da Ad Library do Facebook
  blockFbCrawler: boolean;   // robô revisor do FB (cloaking — default desligado)
}

const DEFAULT_CATEGORIES: TrafficCategories = {
  blockSpies: true,
  blockDatacenter: true,
  blockAdLibrary: true,
  blockFbCrawler: false,
};

/**
 * Veredito final. Precedência:
 *   1. ALLOW explícito que casa  → allow
 *   2. BLOCK explícito que casa  → block
 *   3. default-por-sinal (modulado pelas categorias)
 * Fail-open: na dúvida (e quando há fbclid) → allow.
 */
export function evaluateRules(
  s: TrafficSignals,
  rules: TrafficFilterRule[],
  categories: TrafficCategories = DEFAULT_CATEGORIES,
): "allow" | "block" {
  const active = rules.filter((r) => r.is_active);

  // Robô revisor do FB: a CHAVE (flag) é a autoridade sobre a classe (os 3
  // user-agents), tratada junta. Vem ANTES das regras explícitas de propósito —
  // as seeds antigas (allow do crawler, migrations 043/044) não devem mais
  // mandar; quem manda é a flag. Ligada → block (cloaking). Desligada → allow
  // (e o crawler NÃO cai no blockSpies abaixo: não tem fbclid mas é legítimo).
  if (isFbCrawler(s.userAgent)) {
    return categories.blockFbCrawler ? "block" : "allow";
  }

  if (active.some((r) => r.list === "allow" && ruleMatches(r, s))) return "allow";
  if (active.some((r) => r.list === "block" && ruleMatches(r, s))) return "block";

  // Clique real de anúncio sempre passa.
  if (s.fbclid && s.fbclid.length > 0) return "allow";

  // Default por sinal — cada categoria pode ser desligada pelo usuário:
  if (categories.blockDatacenter && s.isHosting) return "block";
  if (categories.blockAdLibrary && s.referer && s.referer.toLowerCase().includes("ads/library")) return "block";
  if (categories.blockSpies) {
    if (!s.userAgent) return "block";   // sem UA = suspeito
    return "block";                     // humano sem fbclid = espião
  }

  // Nenhuma categoria pegou → deixa passar (usuário afrouxou o filtro).
  return "allow";
}
