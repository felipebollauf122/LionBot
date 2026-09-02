import type { TrafficFilterRule } from "@/lib/types/database";

export interface TrafficSignals {
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  fbclid: string | null;
  ttclid: string | null;    // click id do TikTok Ads (equivalente ao fbclid)
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
 * Robô da ByteDance/TikTok — o equivalente ao revisor do Facebook. Rasteja a
 * landing quando o anúncio entra em revisão e quando o link é postado.
 *
 * A lista é DELIBERADAMENTE de tokens específicos de robô. O token solto
 * "bytedance" NÃO pode entrar: o webview in-app do TikTok (comprador real,
 * onde o clique pago abre) manda `BytedanceWebview/... musical_ly_...` no
 * User-Agent — casar "bytedance" barraria justamente o comprador. O guard
 * TIKTOK_HUMAN_UAS abaixo é a rede de segurança pra isso.
 *
 * Ao contrário dos 3 UAs do Facebook (documentados pela Meta), estes vêm de
 * observação de log/fontes de terceiros — a ByteDance não publica lista
 * oficial. Se aparecer um UA novo de robô, dá pra bloquear/liberar na mão
 * pelas regras avançadas (match_type user_agent) sem mexer no código.
 */
const TIKTOK_CRAWLER_UAS = [
  "bytespider",
  "tiktokspider",
  "tiktokbot",
  "bytedance-crawler",
  "bytedance-security",
];

/**
 * Marcas do app/webview do TikTok — HUMANO, nunca robô. Se qualquer uma
 * aparece no UA, isTiktokCrawler devolve false mesmo que algum token de
 * crawler case por acidente. Comprador antes de tudo (fail-open).
 */
const TIKTOK_HUMAN_UAS = ["bytedancewebview", "musical_ly", "musically", "trill_", "aweme"];

/** True se o User-Agent é de um robô da ByteDance/TikTok (e não do app real). */
export function isTiktokCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  if (TIKTOK_HUMAN_UAS.some((h) => ua.includes(h))) return false;
  return TIKTOK_CRAWLER_UAS.some((c) => ua.includes(c));
}

/**
 * Referers das vitrines onde CONCORRENTE espia anúncio alheio — Meta e TikTok.
 * `ads/library` = Biblioteca de Anúncios do Facebook; `library.tiktok.com` =
 * Commercial Content Library; `creativecenter` = TikTok Creative Center (aba
 * "Top Ads", que é literalmente um catálogo de anúncios de terceiros).
 *
 * NÃO inclui adsmanager/business manager de propósito: de lá quem clica é o
 * PRÓPRIO dono testando o link do anúncio, não um espião.
 */
const AD_LIBRARY_REFERERS = ["ads/library", "library.tiktok.com", "creativecenter"];

/** True se o referer veio de uma vitrine de espiar anúncio (FB ou TikTok). */
export function isAdLibraryReferer(referer: string | null): boolean {
  if (!referer) return false;
  const ref = referer.toLowerCase();
  return AD_LIBRARY_REFERERS.some((d) => ref.includes(d));
}

/** Referers de onde um clique real de anúncio do FB/IG costuma vir. */
const FB_REFERERS = ["facebook.com", "l.facebook.com", "lm.facebook.com", "fb.me", "instagram.com", "l.instagram.com"];

/**
 * Heurística pra distinguir um fbclid de clique REAL de um forjado (ex:
 * `?fbclid=teste`). NÃO é validação criptográfica — o fbclid é opaco e o FB não
 * oferece API. É permissiva DE PROPÓSITO (nunca barrar cliente legítimo):
 * basta UM sinal plausível.
 *
 * Conta como válido se:
 *   - o formato é plausível (comprimento real + charset do fbclid), OU
 *   - veio com referer do Facebook/Instagram (clique veio de lá).
 */
export function isLikelyRealFbclid(fbclid: string | null, referer: string | null): boolean {
  if (!fbclid) return false;
  const id = fbclid.trim();
  if (!id) return false;

  // Sinal 1: referer do FB/IG → clique veio mesmo de lá.
  if (referer) {
    const ref = referer.toLowerCase();
    if (FB_REFERERS.some((d) => ref.includes(d))) return true;
  }

  // Sinal 2: formato plausível. fbclid real é longo (~50-200) e usa o charset
  // base64-url (A-Z a-z 0-9 _ -). "teste", "banana", "123" não passam.
  const plausibleCharset = /^[A-Za-z0-9_-]+$/.test(id);
  if (plausibleCharset && id.length >= 20) return true;

  return false;
}

/** Domínios que aparecem no referer de um clique real vindo do TikTok. */
const TIKTOK_REFERERS = ["tiktok.com", "ttwid", "bytedance", "musical.ly"];

/**
 * Piso de comprimento quando o ttclid vem SOZINHO (sem referer do TikTok).
 * O ttclid real de campanha é gigante (~250-400 chars, prefixado `E.C.P.` /
 * `E_C_P_`), então 50 é folgadíssimo — ~5x menor que o menor valor real que
 * aparece em campanha, logo não corre risco de barrar comprador. Ao mesmo
 * tempo mata o bypass trivial que o fbclid tem: lá o `length >= 20` deixa um
 * espião colar `?fbclid=<20 chars aleatórios>` e entrar. Aqui não entra.
 */
const TTCLID_MIN_LENGTH = 50;

/**
 * Piso quando o referer JÁ confirma que veio do TikTok. Aí o referer é a
 * corroboração e o formato só precisa não ser lixo tipo "teste"/"1".
 */
const TTCLID_MIN_LENGTH_WITH_REFERER = 16;

/**
 * Espelha isLikelyRealFbclid para o clique pago do TikTok (?ttclid=...), mas
 * SEM herdar a fraqueza dela (o piso de 20 chars, forjável em 2 segundos).
 *
 * O referer é BÔNUS, nunca requisito: o webview in-app do TikTok abre a landing
 * frequentemente sem referer nenhum — se dependesse dele, o comprador real
 * cairia na landing de venda. Por isso o formato sozinho basta, desde que
 * tenha o comprimento real do ttclid.
 */
export function isLikelyRealTtclid(ttclid: string | null, referer: string | null): boolean {
  if (!ttclid) return false;
  const id = ttclid.trim();
  if (!id) return false;

  // Charset do ttclid real: base64-url MAIS o ponto — os prefixos conhecidos
  // (`E.C.P.…`) usam '.' como separador. Qualquer outro caractere não é ttclid.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return false;

  // Sinal 1: referer do TikTok → o clique veio mesmo de lá.
  if (referer) {
    const ref = referer.toLowerCase();
    if (TIKTOK_REFERERS.some((d) => ref.includes(d)) && id.length >= TTCLID_MIN_LENGTH_WITH_REFERER) return true;
  }

  // Sinal 2: formato plausível sozinho (caso do webview sem referer).
  return id.length >= TTCLID_MIN_LENGTH;
}

/**
 * Categorias do filtro (botões liga/desliga na UI). Cada flag liga/desliga um
 * pedaço do "default por sinal". Default = comportamento clássico.
 */
export interface TrafficCategories {
  blockSpies: boolean;          // humano sem fbclid/ttclid (espião)
  blockDatacenter: boolean;     // IP de datacenter/VPN/proxy
  blockAdLibrary: boolean;      // veio da Ad Library do FB / Creative Center do TikTok
  blockFbCrawler: boolean;      // robô revisor do FB (cloaking — default desligado)
  blockTiktokCrawler: boolean;  // robô da ByteDance/TikTok (cloaking — default desligado)
}

const DEFAULT_CATEGORIES: TrafficCategories = {
  blockSpies: true,
  blockDatacenter: true,
  blockAdLibrary: true,
  blockFbCrawler: false,
  blockTiktokCrawler: false,
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

  // Robô da ByteDance/TikTok: mesma lógica, chave própria. Sem isto o revisor
  // do TikTok caía no blockSpies (não traz ttclid nenhum) e via a landing de
  // venda em vez da página real — cloaking involuntário, ou seja, anúncio
  // reprovado sem o dono nunca ter pedido isso. Default da flag = false =
  // robô PASSA, igual ao do Facebook.
  if (isTiktokCrawler(s.userAgent)) {
    return categories.blockTiktokCrawler ? "block" : "allow";
  }

  if (active.some((r) => r.list === "allow" && ruleMatches(r, s))) return "allow";
  if (active.some((r) => r.list === "block" && ruleMatches(r, s))) return "block";

  // Clique real de anúncio passa. Agora exige um fbclid PLAUSÍVEL (formato real
  // ou referer do FB) — um `?fbclid=teste` forjado não basta mais e cai nos
  // checks de espião abaixo. Permissivo de propósito: nunca barra clique real.
  // O ttclid entra no MESMO ponto: um clique do TikTok Ads chega só com
  // ?ttclid= (sem fbclid) e antes caía direto no blockSpies — comprador pago
  // via a landing de venda e nenhum page_view/tid nascia.
  if (isLikelyRealFbclid(s.fbclid, s.referer) || isLikelyRealTtclid(s.ttclid, s.referer)) return "allow";

  // Default por sinal — cada categoria pode ser desligada pelo usuário:
  if (categories.blockDatacenter && s.isHosting) return "block";
  if (categories.blockAdLibrary && isAdLibraryReferer(s.referer)) return "block";
  if (categories.blockSpies) {
    if (!s.userAgent) return "block";   // sem UA = suspeito
    return "block";                     // humano sem fbclid = espião
  }

  // Nenhuma categoria pegou → deixa passar (usuário afrouxou o filtro).
  return "allow";
}
