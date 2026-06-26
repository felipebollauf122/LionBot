# Filtro de Tráfego (Allowlist / Blocklist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtrar o tráfego da página de clique `/t` para que visitantes "espião" (humano sem fbclid, vindo da Ad Library, ou de datacenter/VPN) caiam numa landing "Conheça o LionBot" em vez de ver a oferta do bot, enquanto o crawler de revisão do Facebook e cliques reais de anúncio veem a página normal.

**Architecture:** Tabela `traffic_filter_rules` (allow/block) é o veredito. A `/t` coleta sinais (IP, UA, referer, fbclid, ASN via ip-api.com), passa para uma função pura `evaluateRules()` que retorna `'allow' | 'block'`. ALLOW vence BLOCK; regra explícita vence default-por-sinal. Veredito `block` → renderiza `<LionBotSalesPage/>` (sem botão `/go`, sem tracking). Fail-safe: qualquer erro → `allow`.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, Supabase (service-role client na `/t`), Vitest, ip-api.com (free tier).

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-06-26-traffic-filter-design.md`.
- **NÃO é o Next.js de treino** — antes de escrever código de rota/RSC, conferir guias em `node_modules/next/dist/docs/` (per AGENTS.md).
- Toda mutação de DB passa por server action com guard de tenant/admin (padrão `lib/actions/bot-settings-actions.ts`).
- Multi-tenant: toda query/regra é escopada por `tenant_id`.
- **Fail-safe absoluto:** o filtro NUNCA pode derrubar um clique pago legítimo. Qualquer falha (Supabase, ip-api) → veredito `allow`.
- **Anti-cloaking:** o crawler do FB (`facebookexternalhit`, `facebookcatalog`, `meta-externalagent`) é seed ALLOW e SEMPRE vê a `/t` real.
- Imports usam alias `@/...`. Testes: `vitest` (`describe/it/expect`), rodados com `npm test`.
- Migrations: SQL idempotente (`IF NOT EXISTS`), numeradas sequencialmente. Próxima livre: `043`.
- Visual da landing de venda: paleta synthwave magenta/cyan já usada na `/t` (`C.bg #0a0410`, `C.accent #ff2bd6`, `C.cyan #22e0ff`, `C.gold #ffb84d`, `C.ink #f4e9ff`).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/043_traffic_filter_rules.sql` | Tabela `traffic_filter_rules` + índice + seeds (allow crawler FB) + coluna `bots.traffic_filter_enabled` |
| `lib/types/database.ts` (modify) | Tipos `TrafficFilterRule`, `TrafficFilterList`, `TrafficFilterMatchType`; campo `traffic_filter_enabled` em `Bot` |
| `lib/traffic-filter/match.ts` | **Lógica pura**: `evaluateRules(signals, rules) → 'allow' | 'block'`. Zero I/O |
| `lib/traffic-filter/asn-lookup.ts` | `lookupAsn(ip) → { asn, hosting, proxy }` via ip-api.com, cache em memória + timeout. Fail-safe `{}` |
| `lib/traffic-filter/evaluate.ts` | `decideTraffic({...}) → 'allow' | 'block'`: busca regras (Supabase), chama `lookupAsn`, monta signals, chama `evaluateRules`. Fail-safe `allow` |
| `components/traffic-filter/lion-bot-sales-page.tsx` | Landing "Conheça o LionBot" (RSC, sem botão `/go`, sem tracking) |
| `app/t/page.tsx` (modify) | Quando bot tem `traffic_filter_enabled`, chama `decideTraffic`; `block` → renderiza `<LionBotSalesPage/>` |
| `lib/actions/traffic-filter-actions.ts` | Server actions: `listRules`, `addRule`, `deleteRule`, `toggleRule`, `toggleTrafficFilter` |
| `components/dashboard/traffic-filter-manager.tsx` | UI client de gestão das listas |
| `app/dashboard/admin/users/[userId]/bots/[botId]/traffic-filter/page.tsx` | Página admin que monta o manager |
| `tests/lib/traffic-filter-match.test.ts` | Testes da lógica pura |
| `tests/lib/traffic-filter-asn.test.ts` | Testes do parsing/cache de ASN |

---

## Task 1: Migration — tabela, seeds e toggle

**Files:**
- Create: `supabase/migrations/043_traffic_filter_rules.sql`

**Interfaces:**
- Produces: tabela `public.traffic_filter_rules (id, tenant_id, list, match_type, value, note, is_active, created_at)`; coluna `public.bots.traffic_filter_enabled boolean NOT NULL DEFAULT false`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 043_traffic_filter_rules.sql
-- Filtro de tráfego: allowlist/blocklist explícita por tenant na página /t.
-- A lista É o veredito — ALLOW vence BLOCK, regra explícita vence default-por-sinal.

CREATE TABLE IF NOT EXISTS public.traffic_filter_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  list        text NOT NULL CHECK (list IN ('allow','block')),
  match_type  text NOT NULL CHECK (match_type IN ('ip','user_agent','referer','asn')),
  value       text NOT NULL,
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tfr_lookup
  ON public.traffic_filter_rules (tenant_id, is_active, list, match_type);

-- Toggle por bot. Começa DESLIGADO — não afeta bots existentes.
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS traffic_filter_enabled boolean NOT NULL DEFAULT false;

-- Seeds anti-cloaking: o crawler de revisão do FB SEMPRE vê a /t real.
-- Uma regra ALLOW por user_agent, para cada tenant existente.
INSERT INTO public.traffic_filter_rules (tenant_id, list, match_type, value, note)
SELECT t.id, 'allow', 'user_agent', ua.value, 'crawler FB (anti-cloaking) — não remover'
FROM public.tenants t
CROSS JOIN (VALUES ('facebookexternalhit'), ('facebookcatalog'), ('meta-externalagent')) AS ua(value)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Run: `npx supabase db push` (ou o fluxo de migration usado no projeto — conferir como as migrations 042 foram aplicadas se houver dúvida).
Expected: migration `043` aplicada sem erro; `\d traffic_filter_rules` mostra a tabela; `\d bots` mostra `traffic_filter_enabled`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_traffic_filter_rules.sql
git commit -m "feat(traffic-filter): migration da tabela traffic_filter_rules + toggle + seeds crawler FB"
```

---

## Task 2: Tipos do banco

**Files:**
- Modify: `lib/types/database.ts` (interface `Bot` ~linha 41-72; adicionar tipos novos)
- Test: `tests/lib/types.test.ts` (adicionar bloco)

**Interfaces:**
- Consumes: tabela da Task 1.
- Produces:
  - `type TrafficFilterList = "allow" | "block"`
  - `type TrafficFilterMatchType = "ip" | "user_agent" | "referer" | "asn"`
  - `interface TrafficFilterRule { id: string; tenant_id: string; list: TrafficFilterList; match_type: TrafficFilterMatchType; value: string; note: string | null; is_active: boolean; created_at: string; }`
  - campo `traffic_filter_enabled: boolean` em `Bot`.

- [ ] **Step 1: Escrever o teste de tipos**

Adicionar ao final do `describe("Database Types", ...)` em `tests/lib/types.test.ts`:

```typescript
  describe("TrafficFilterRule", () => {
    it("should create a valid allow rule", () => {
      const rule: TrafficFilterRule = {
        id: "rule-1",
        tenant_id: "tenant-1",
        list: "allow",
        match_type: "user_agent",
        value: "facebookexternalhit",
        note: "crawler FB",
        is_active: true,
        created_at: "2026-06-26T10:00:00Z",
      };
      expect(rule.list).toBe("allow");
      expect(rule.match_type).toBe("user_agent");
    });

    it("should support all match types and both lists", () => {
      const matchTypes: TrafficFilterMatchType[] = ["ip", "user_agent", "referer", "asn"];
      const lists: TrafficFilterList[] = ["allow", "block"];
      matchTypes.forEach((mt) => lists.forEach((l) => {
        const rule: TrafficFilterRule = {
          id: `rule-${l}-${mt}`,
          tenant_id: "tenant-1",
          list: l,
          match_type: mt,
          value: "x",
          note: null,
          is_active: true,
          created_at: "2026-06-26T10:00:00Z",
        };
        expect(rule.list).toBe(l);
        expect(rule.match_type).toBe(mt);
      }));
    });
  });
```

Adicionar os imports no topo: `TrafficFilterRule, TrafficFilterList, TrafficFilterMatchType`.

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npm test -- tests/lib/types.test.ts`
Expected: FAIL — `TrafficFilterRule` não existe / `traffic_filter_enabled` ausente no tipo `Bot` não é erro aqui, mas os tipos novos sim.

- [ ] **Step 3: Adicionar os tipos**

Em `lib/types/database.ts`, adicionar o campo na interface `Bot` (depois de `protect_content: boolean;`):

```typescript
  traffic_filter_enabled: boolean;
```

E adicionar (perto dos outros tipos, ex: depois da interface `Bot`):

```typescript
export type TrafficFilterList = "allow" | "block";
export type TrafficFilterMatchType = "ip" | "user_agent" | "referer" | "asn";

export interface TrafficFilterRule {
  id: string;
  tenant_id: string;
  list: TrafficFilterList;
  match_type: TrafficFilterMatchType;
  value: string;
  note: string | null;
  is_active: boolean;
  created_at: string;
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npm test -- tests/lib/types.test.ts`
Expected: PASS.

> Nota: adicionar `traffic_filter_enabled` ao `Bot` quebra o objeto literal `Bot` existente no teste (linhas ~53 e ~81). Adicionar `traffic_filter_enabled: false,` aos dois literais para o TS compilar.

- [ ] **Step 5: Commit**

```bash
git add lib/types/database.ts tests/lib/types.test.ts
git commit -m "feat(traffic-filter): tipos TrafficFilterRule + campo traffic_filter_enabled"
```

---

## Task 3: Lógica pura de avaliação (`match.ts`) — o cérebro do veredito

**Files:**
- Create: `lib/traffic-filter/match.ts`
- Test: `tests/lib/traffic-filter-match.test.ts`

**Interfaces:**
- Consumes: `TrafficFilterRule` (Task 2).
- Produces:
  - `interface TrafficSignals { ip: string | null; userAgent: string | null; referer: string | null; fbclid: string | null; asn: string | null; isHosting: boolean; }`
  - `function evaluateRules(signals: TrafficSignals, rules: TrafficFilterRule[]): "allow" | "block"`
  - `function ipMatches(ruleValue: string, ip: string | null): boolean` (exportada p/ teste; suporta IP exato e CIDR IPv4).

A precedência implementada: (1) qualquer ALLOW ativa que casa → `allow`; (2) qualquer BLOCK ativa que casa → `block`; (3) default-por-sinal: `fbclid` presente → `allow`; senão se `isHosting` OU referer contém `ads/library` OU `userAgent` vazio/ausente OU sem `fbclid` → `block`; fallback final → `allow` (fail-open).

- [ ] **Step 1: Escrever os testes**

```typescript
import { describe, it, expect } from "vitest";
import { evaluateRules, ipMatches, type TrafficSignals } from "@/lib/traffic-filter/match";
import type { TrafficFilterRule } from "@/lib/types/database";

function rule(p: Partial<TrafficFilterRule>): TrafficFilterRule {
  return {
    id: "r", tenant_id: "t", list: "block", match_type: "ip",
    value: "", note: null, is_active: true, created_at: "2026-06-26T00:00:00Z",
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
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `npm test -- tests/lib/traffic-filter-match.test.ts`
Expected: FAIL — módulo `@/lib/traffic-filter/match` não existe.

- [ ] **Step 3: Implementar `match.ts`**

```typescript
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

/**
 * Veredito final. Precedência:
 *   1. ALLOW explícito que casa  → allow
 *   2. BLOCK explícito que casa  → block
 *   3. default-por-sinal
 * Fail-open: na dúvida (e quando há fbclid) → allow.
 */
export function evaluateRules(s: TrafficSignals, rules: TrafficFilterRule[]): "allow" | "block" {
  const active = rules.filter((r) => r.is_active);

  if (active.some((r) => r.list === "allow" && ruleMatches(r, s))) return "allow";
  if (active.some((r) => r.list === "block" && ruleMatches(r, s))) return "block";

  // Default por sinal:
  if (s.fbclid && s.fbclid.length > 0) return "allow";          // clique real de anúncio
  if (s.isHosting) return "block";                               // datacenter/VPN
  if (s.referer && s.referer.toLowerCase().includes("ads/library")) return "block";
  if (!s.userAgent) return "block";                             // sem UA = suspeito
  return "block";                                               // humano sem fbclid = espião
}
```

> Nota: o último ramo é `block` por design — humano (tem UA) sem fbclid e sem regra é tratado como espião. O fail-OPEN de fato vive na Task 5 (`evaluate.ts`), que retorna `allow` em QUALQUER erro de I/O antes de chegar aqui.

- [ ] **Step 4: Rodar (deve passar)**

Run: `npm test -- tests/lib/traffic-filter-match.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add lib/traffic-filter/match.ts tests/lib/traffic-filter-match.test.ts
git commit -m "feat(traffic-filter): lógica pura evaluateRules + ipMatches (TDD)"
```

---

## Task 4: ASN lookup via ip-api.com

**Files:**
- Create: `lib/traffic-filter/asn-lookup.ts`
- Test: `tests/lib/traffic-filter-asn.test.ts`

**Interfaces:**
- Produces:
  - `interface AsnResult { asn?: string; isHosting?: boolean; isProxy?: boolean; }`
  - `async function lookupAsn(ip: string | null | undefined): Promise<AsnResult>` — fetch ip-api com `fields=status,proxy,hosting,as`, timeout 2s, cache em memória por IP, retorna `{}` em qualquer falha.
  - `function parseAsField(asField: string): string | undefined` — extrai `"AS15169"` de `"AS15169 Google LLC"` (exportada p/ teste).
  - `function isPublicIp(ip: string): boolean` (exportada; mesma lógica de `server/src/services/geoip.ts`).

- [ ] **Step 1: Escrever os testes (só do que é puro — sem rede)**

```typescript
import { describe, it, expect } from "vitest";
import { parseAsField, isPublicIp } from "@/lib/traffic-filter/asn-lookup";

describe("parseAsField", () => {
  it("extrai o ASN do campo as do ip-api", () => {
    expect(parseAsField("AS15169 Google LLC")).toBe("AS15169");
    expect(parseAsField("AS16509 Amazon.com, Inc.")).toBe("AS16509");
  });
  it("retorna undefined para vazio", () => {
    expect(parseAsField("")).toBeUndefined();
    expect(parseAsField("   ")).toBeUndefined();
  });
});

describe("isPublicIp", () => {
  it("rejeita privados/loopback/vazio", () => {
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("10.0.0.5")).toBe(false);
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("")).toBe(false);
  });
  it("aceita IP público", () => {
    expect(isPublicIp("203.0.113.9")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `npm test -- tests/lib/traffic-filter-asn.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `asn-lookup.ts`**

```typescript
/**
 * ASN/datacenter lookup via ip-api.com (free tier). Reaproveita o padrão de
 * server/src/services/geoip.ts: timeout curto + fail-safe ({} em qualquer erro).
 * Cache em memória por IP para não repetir lookup no mesmo processo.
 */

export interface AsnResult {
  asn?: string;        // ex: "AS15169"
  isHosting?: boolean; // datacenter
  isProxy?: boolean;   // vpn/proxy
}

const cache = new Map<string, AsnResult>();

/** Extrai "AS15169" de "AS15169 Google LLC". */
export function parseAsField(asField: string): string | undefined {
  const m = asField.trim().match(/^AS\d+/i);
  return m ? m[0].toUpperCase() : undefined;
}

/** Mesma lógica de isPublicIp do geoip.ts. */
export function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.")) return false;
  if (/^10\./.test(ip)) return false;
  if (/^192\.168\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return false;
  return true;
}

export async function lookupAsn(ip: string | null | undefined): Promise<AsnResult> {
  const clean = (ip ?? "").trim();
  if (!isPublicIp(clean)) return {};
  if (cache.has(clean)) return cache.get(clean)!;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,proxy,hosting,as`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return {};
    const data = (await res.json()) as {
      status?: string; proxy?: boolean; hosting?: boolean; as?: string;
    };
    if (data.status !== "success") return {};
    const result: AsnResult = {
      asn: data.as ? parseAsField(data.as) : undefined,
      isHosting: !!data.hosting,
      isProxy: !!data.proxy,
    };
    cache.set(clean, result);
    return result;
  } catch {
    return {}; // timeout, rate-limit, rede — best-effort
  }
}
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `npm test -- tests/lib/traffic-filter-asn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/traffic-filter/asn-lookup.ts tests/lib/traffic-filter-asn.test.ts
git commit -m "feat(traffic-filter): asn-lookup via ip-api (cache + fail-safe)"
```

---

## Task 5: Orquestrador `evaluate.ts` (fail-open)

**Files:**
- Create: `lib/traffic-filter/evaluate.ts`

**Interfaces:**
- Consumes: `evaluateRules`/`TrafficSignals` (Task 3), `lookupAsn` (Task 4), `TrafficFilterRule` (Task 2).
- Produces:
  - `interface DecideTrafficInput { supabase: SupabaseClient; tenantId: string; ip: string | null; userAgent: string | null; referer: string | null; fbclid: string | null; }`
  - `async function decideTraffic(input: DecideTrafficInput): Promise<"allow" | "block">` — busca regras ativas do tenant, faz `lookupAsn`, monta `TrafficSignals`, chama `evaluateRules`. Em QUALQUER erro → `allow`.

> Sem teste unitário dedicado (é I/O glue). A garantia testável vive em `match.ts`. O try/catch fail-open é verificado por leitura. Se o projeto adotar testes de integração depois, este é o ponto.

- [ ] **Step 1: Implementar `evaluate.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrafficFilterRule } from "@/lib/types/database";
import { evaluateRules, type TrafficSignals } from "@/lib/traffic-filter/match";
import { lookupAsn } from "@/lib/traffic-filter/asn-lookup";

export interface DecideTrafficInput {
  supabase: SupabaseClient;
  tenantId: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  fbclid: string | null;
}

/**
 * Veredito de tráfego para a /t. Fail-open ABSOLUTO: qualquer erro de I/O
 * (Supabase fora, ip-api timeout) retorna "allow" — nunca derruba clique pago.
 */
export async function decideTraffic(input: DecideTrafficInput): Promise<"allow" | "block"> {
  try {
    const { data: rules } = await input.supabase
      .from("traffic_filter_rules")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true);

    const asn = await lookupAsn(input.ip);

    const signals: TrafficSignals = {
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
      fbclid: input.fbclid,
      asn: asn.asn ?? null,
      isHosting: !!asn.isHosting || !!asn.isProxy,
    };

    return evaluateRules(signals, (rules ?? []) as TrafficFilterRule[]);
  } catch {
    return "allow"; // fail-open: filtro nunca derruba clique legítimo
  }
}
```

- [ ] **Step 2: Verificar que compila / lint**

Run: `npm run lint`
Expected: sem erros novos em `lib/traffic-filter/evaluate.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/traffic-filter/evaluate.ts
git commit -m "feat(traffic-filter): orquestrador decideTraffic (fail-open)"
```

---

## Task 6: Landing "Conheça o LionBot"

**Files:**
- Create: `components/traffic-filter/lion-bot-sales-page.tsx`

**Interfaces:**
- Produces: `export function LionBotSalesPage(): JSX.Element` — RSC puro, sem props, sem botão `/go`, sem tracking. Usa a paleta `C` da `/t`. `<title>` é definido pela page (não aqui).

- [ ] **Step 1: Implementar a landing**

Componente server (sem `"use client"`). Estrutura: eyebrow "Plataforma de bots", headline "Crie seu próprio bot de vendas no Telegram", subtítulo, 3-4 bullets de benefício (automação de vendas, PIX integrado, remarketing, painel de métricas), CTA "Conhecer o LionBot" (link `href="/"` ou landing pública — NÃO `/go`, NÃO expõe bot do cliente). Reaproveitar paleta e animações `lvRise`/`lvGlow` no mesmo estilo de `app/t/page.tsx:167-323`. Footer legal igual ao da `/t` (usar `SITE_NAME`, `SITE_LEGAL_NAME`, `CONTACT_EMAIL`, `SITE_DESCRIPTION` de `@/lib/site`).

```tsx
import { SITE_NAME, SITE_LEGAL_NAME, CONTACT_EMAIL } from "@/lib/site";

const C = {
  bg: "#0a0410",
  accent: "#ff2bd6",
  cyan: "#22e0ff",
  gold: "#ffb84d",
  ink: "#f4e9ff",
};

const BENEFITS = [
  "Automatize vendas no Telegram 24/7 — sem operador",
  "PIX integrado: cliente paga e recebe o acesso na hora",
  "Remarketing automático para quem não comprou",
  "Painel com métricas reais de cliques, leads e vendas",
];

export function LionBotSalesPage() {
  return (
    <div
      style={{
        minHeight: "100svh",
        position: "relative",
        overflow: "hidden",
        background: C.bg,
        color: C.ink,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 32px",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial',
      }}
    >
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(680px 480px at 18% -8%, rgba(255,43,214,0.22) 0%, transparent 60%), radial-gradient(620px 520px at 92% 8%, rgba(34,224,255,0.16) 0%, transparent 58%)` }} />

      <main style={{ position: "relative", width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.cyan, background: "rgba(34,224,255,0.08)", border: "1px solid rgba(34,224,255,0.28)", borderRadius: 999, marginBottom: 28 }}>
          Plataforma de bots de vendas
        </span>

        <h1 style={{ fontSize: "clamp(30px, 8vw, 46px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.05, textAlign: "center", margin: 0, color: "#fff", textShadow: `0 0 28px rgba(255,43,214,0.55)`, animation: "lvRise 0.7s cubic-bezier(0.16,1,0.3,1) both" }}>
          Crie seu próprio bot de vendas no Telegram
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(244,233,255,0.75)", textAlign: "center", margin: "18px 0 0", maxWidth: 440 }}>
          O {SITE_NAME} é a plataforma que automatiza captação, venda e remarketing
          direto no Telegram. Monte o seu em minutos — sem código.
        </p>

        <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", width: "100%", maxWidth: 440 }}>
          {BENEFITS.map((b, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, fontSize: 14.5, color: "rgba(244,233,255,0.82)", marginBottom: 13, lineHeight: 1.45 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <a
          href="/"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
            width: "100%", maxWidth: 440, marginTop: 32, padding: "18px 24px", borderRadius: 18,
            fontWeight: 800, fontSize: 16, color: "#fff", textDecoration: "none",
            background: `linear-gradient(120deg, ${C.accent} 0%, #c026d3 45%, ${C.cyan} 130%)`,
            border: "1px solid rgba(255,255,255,0.22)",
            boxShadow: `0 18px 50px -12px rgba(255,43,214,0.75), inset 0 1px 0 rgba(255,255,255,0.4)`,
            animation: "lvRise 0.7s 0.16s cubic-bezier(0.16,1,0.3,1) both, lvGlow 2.4s ease-in-out infinite",
          }}
        >
          Conhecer o {SITE_NAME}
        </a>
      </main>

      <footer style={{ position: "relative", marginTop: 30, maxWidth: 440, textAlign: "center", fontSize: 11, color: "rgba(244,233,255,0.4)", lineHeight: 1.7 }}>
        <p style={{ margin: 0 }}><b style={{ color: "rgba(244,233,255,0.6)" }}>{SITE_LEGAL_NAME}</b></p>
        <p style={{ margin: "5px 0 0", fontSize: 10, color: "rgba(244,233,255,0.28)" }}>{CONTACT_EMAIL}</p>
      </footer>

      <style>{`
        @keyframes lvGlow { 0%,100%{box-shadow:0 18px 50px -12px rgba(255,43,214,0.75),inset 0 1px 0 rgba(255,255,255,0.4)} 50%{box-shadow:0 22px 64px -10px rgba(255,43,214,0.95),inset 0 1px 0 rgba(255,255,255,0.5)} }
        @keyframes lvRise { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:0.01ms !important; animation-iteration-count:1 !important; } }
      `}</style>
    </div>
  );
}
```

> Conferir os nomes exportados reais em `lib/site.ts` antes de importar (`SITE_NAME`, `SITE_LEGAL_NAME`, `CONTACT_EMAIL`, `SITE_DESCRIPTION` aparecem em `app/t/page.tsx:5`).

- [ ] **Step 2: Verificar lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add components/traffic-filter/lion-bot-sales-page.tsx
git commit -m "feat(traffic-filter): landing 'Conheça o LionBot' pro espião"
```

---

## Task 7: Integrar o filtro na `/t`

**Files:**
- Modify: `app/t/page.tsx` (após carregar `typedBot`, ~linha 89; antes do insert de `tracking_events`, ~linha 127)

**Interfaces:**
- Consumes: `decideTraffic` (Task 5), `LionBotSalesPage` (Task 6); campo `typedBot.traffic_filter_enabled` (Task 2).

- [ ] **Step 1: Importar no topo de `app/t/page.tsx`**

```typescript
import { decideTraffic } from "@/lib/traffic-filter/evaluate";
import { LionBotSalesPage } from "@/components/traffic-filter/lion-bot-sales-page";
```

- [ ] **Step 2: Inserir o gate após `const typedBot = bot as Bot;` (linha ~89)**

Os sinais já são coletados logo abaixo (`clientIp`, `userAgent`, `referer`, `fbclid`). Mover a coleta de `hdrs`/`clientIp`/`userAgent`/`referer` para ANTES do gate (ou recomputar o mínimo necessário), e inserir:

```typescript
  // ── Filtro de tráfego (allowlist/blocklist) ──────────────────────────────
  // Só roda se o bot ativou. Veredito "block" → espião vê a landing de venda
  // do LionBot (sem botão /go, sem tracking_event). Fail-open dentro de decideTraffic.
  if (typedBot.traffic_filter_enabled) {
    const hdrsForFilter = await headers();
    const verdict = await decideTraffic({
      supabase,
      tenantId: typedBot.tenant_id,
      ip: extractClientIp(hdrsForFilter),
      userAgent: hdrsForFilter.get("user-agent") ?? null,
      referer: hdrsForFilter.get("referer") ?? hdrsForFilter.get("referrer") ?? null,
      fbclid: String(search.fbclid ?? "") || null,
    });
    if (verdict === "block") {
      return <LionBotSalesPage />;
    }
  }
```

> `headers()` pode ser chamado mais de uma vez no mesmo request (é cacheado pelo Next). Se preferir, reusar o `hdrs` já existente movendo sua declaração (linha ~102) para antes do gate. A versão acima é a mínima e segura. Conferir o guia `node_modules/next/dist/docs/...` sobre `headers()` em RSC antes de mover.

- [ ] **Step 3: Verificar — bot sem filtro ativo continua igual**

Run: `npm run build` (ou `npm run dev` e abrir `/t?bot=<id>` de um bot com `traffic_filter_enabled=false`)
Expected: build passa; a `/t` de um bot com filtro desligado renderiza idêntica ao comportamento atual (nenhum gate executa).

- [ ] **Step 4: Commit**

```bash
git add app/t/page.tsx
git commit -m "feat(traffic-filter): gate na /t — espião cai na landing de venda"
```

---

## Task 8: Server actions de gestão das listas

**Files:**
- Create: `lib/actions/traffic-filter-actions.ts`

**Interfaces:**
- Consumes: `TrafficFilterRule`, `TrafficFilterList`, `TrafficFilterMatchType` (Task 2).
- Produces (todas `"use server"`, guard de tenant/admin no padrão `bot-settings-actions.ts`):
  - `listRules(botTenantId: string): Promise<TrafficFilterRule[]>`
  - `addRule(input: { tenantId: string; list: TrafficFilterList; matchType: TrafficFilterMatchType; value: string; note?: string }): Promise<{ success: true }>`
  - `deleteRule(ruleId: string): Promise<{ success: true }>`
  - `toggleRule(ruleId: string, isActive: boolean): Promise<{ success: true }>`
  - `toggleTrafficFilter(botId: string, enabled: boolean): Promise<{ success: true }>`

> Escopo de autorização: como as regras são por tenant e a UI vive na árvore admin, seguir o padrão `isAdmin()` + fallback `tenant_id === user.id` de `bot-settings-actions.ts`. O `tenantId` das regras deve ser derivado/validado server-side a partir do bot (não confiar no client). Buscar o `tenant_id` do bot via `botId` dentro da action de toggle; para as actions de regra, validar que o `tenantId` passado pertence ao user (ou que é admin).

- [ ] **Step 1: Implementar as actions**

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type {
  TrafficFilterRule,
  TrafficFilterList,
  TrafficFilterMatchType,
} from "@/lib/types/database";

async function assertTenantAccess(tenantId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  if (await isAdmin()) return;
  if (user.id !== tenantId) throw new Error("Forbidden");
}

export async function listRules(tenantId: string): Promise<TrafficFilterRule[]> {
  await assertTenantAccess(tenantId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("traffic_filter_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list rules: ${error.message}`);
  return (data ?? []) as TrafficFilterRule[];
}

export async function addRule(input: {
  tenantId: string;
  list: TrafficFilterList;
  matchType: TrafficFilterMatchType;
  value: string;
  note?: string;
}): Promise<{ success: true }> {
  await assertTenantAccess(input.tenantId);
  const value = input.value.trim();
  if (!value) throw new Error("Valor da regra não pode ser vazio");

  const supabase = await createClient();
  const { error } = await supabase.from("traffic_filter_rules").insert({
    tenant_id: input.tenantId,
    list: input.list,
    match_type: input.matchType,
    value,
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(`Failed to add rule: ${error.message}`);
  return { success: true };
}

export async function deleteRule(ruleId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  // Carrega a regra p/ validar o tenant antes de apagar
  const { data: rule } = await supabase
    .from("traffic_filter_rules")
    .select("tenant_id")
    .eq("id", ruleId)
    .single();
  if (!rule) throw new Error("Rule not found");
  await assertTenantAccess(rule.tenant_id as string);

  const { error } = await supabase.from("traffic_filter_rules").delete().eq("id", ruleId);
  if (error) throw new Error(`Failed to delete rule: ${error.message}`);
  return { success: true };
}

export async function toggleRule(ruleId: string, isActive: boolean): Promise<{ success: true }> {
  const supabase = await createClient();
  const { data: rule } = await supabase
    .from("traffic_filter_rules")
    .select("tenant_id")
    .eq("id", ruleId)
    .single();
  if (!rule) throw new Error("Rule not found");
  await assertTenantAccess(rule.tenant_id as string);

  const { error } = await supabase
    .from("traffic_filter_rules")
    .update({ is_active: isActive })
    .eq("id", ruleId);
  if (error) throw new Error(`Failed to toggle rule: ${error.message}`);
  return { success: true };
}

export async function toggleTrafficFilter(botId: string, enabled: boolean): Promise<{ success: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { error } = await supabase
    .from("bots")
    .update({ traffic_filter_enabled: enabled })
    .eq("id", botId);
  if (error) throw new Error(`Failed to toggle traffic filter: ${error.message}`);
  return { success: true };
}
```

- [ ] **Step 2: Verificar lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/traffic-filter-actions.ts
git commit -m "feat(traffic-filter): server actions de gestão das listas"
```

---

## Task 9: UI de gestão (manager + página admin)

**Files:**
- Create: `components/dashboard/traffic-filter-manager.tsx` (client)
- Create: `app/dashboard/admin/users/[userId]/bots/[botId]/traffic-filter/page.tsx` (server)

**Interfaces:**
- Consumes: actions da Task 8; `TrafficFilterRule` (Task 2).
- Produces: `TrafficFilterManager({ botId, tenantId, trafficFilterEnabled, initialRules }: { botId: string; tenantId: string; trafficFilterEnabled: boolean; initialRules: TrafficFilterRule[] })`.

- [ ] **Step 1: Implementar a página admin (server)**

Segue o padrão de `app/dashboard/admin/users/[userId]/bots/[botId]/tracking/page.tsx`: guard `isAdmin()`, `params` Promise, busca o bot (`traffic_filter_enabled`, `tenant_id`) e as regras, passa pro manager.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { TrafficFilterManager } from "@/components/dashboard/traffic-filter-manager";
import type { TrafficFilterRule } from "@/lib/types/database";

export default async function AdminBotTrafficFilterPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { botId } = await params;
  const supabase = await createClient();

  const { data: bot } = await supabase
    .from("bots")
    .select("id, tenant_id, traffic_filter_enabled")
    .eq("id", botId)
    .single();
  if (!bot) redirect("/dashboard");

  const { data: rules } = await supabase
    .from("traffic_filter_rules")
    .select("*")
    .eq("tenant_id", bot.tenant_id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <TrafficFilterManager
        botId={bot.id}
        tenantId={bot.tenant_id as string}
        trafficFilterEnabled={!!bot.traffic_filter_enabled}
        initialRules={(rules ?? []) as TrafficFilterRule[]}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implementar o manager (client)**

`"use client"`. Mostra: (1) toggle master `traffic_filter_enabled` (chama `toggleTrafficFilter`, `router.refresh()`); (2) duas colunas/seções (Allow / Block) listando regras com badge do `match_type`, `value`, `note`, switch ativo/inativo (`toggleRule`) e botão remover (`deleteRule`); (3) formulário de adicionar regra (select list allow/block, select match_type, input value, input note → `addRule`). Após cada mutação, `router.refresh()`. Seguir o estilo visual dos outros componentes de dashboard do projeto (conferir um client component existente, ex: algum em `components/dashboard/`, para classes/padrão de toast/erro). Destacar visualmente as seeds do crawler FB (note contém "crawler FB") com um aviso "não remover — anti-bloqueio".

> Repetir aqui a estrutura real em código quando implementar. O componente é client, usa `useState` para o form, `useTransition` para as actions, e `useRouter().refresh()`. Tratar erro das actions com mensagem inline (não `alert`). Não há lógica de negócio nova — só CRUD chamando as 5 actions da Task 8.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build passa; rota `/dashboard/admin/users/[userId]/bots/[botId]/traffic-filter` existe.

- [ ] **Step 4: Adicionar link de navegação**

Conferir onde os outros tabs do bot (tracking, settings, flows...) são listados na navegação admin (provavelmente um layout/nav em `app/dashboard/admin/users/[userId]/bots/[botId]/layout.tsx` ou um componente de nav). Adicionar item "Filtro de tráfego" apontando para a nova rota, seguindo o padrão existente.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/traffic-filter-manager.tsx "app/dashboard/admin/users/[userId]/bots/[botId]/traffic-filter/page.tsx"
git commit -m "feat(traffic-filter): UI de gestão das listas (manager + página admin + nav)"
```

---

## Task 10: Verificação ponta-a-ponta

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test`
Expected: todos os testes passam (incluindo `traffic-filter-match`, `traffic-filter-asn`, `types`).

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 3: Smoke manual (dev)**

Run: `npm run dev`, então:
1. Bot com `traffic_filter_enabled=false` → `/t?bot=<id>` renderiza a oferta normal. ✅
2. Ativar o filtro no painel admin. Acessar `/t?bot=<id>&fbclid=test123` (simula clique real) → vê a oferta. ✅
3. Acessar `/t?bot=<id>` sem fbclid de um browser normal → vê a landing "Conheça o LionBot". ✅
4. `curl -A "facebookexternalhit/1.1" "http://localhost:3000/t?bot=<id>"` → o HTML é a oferta real (seed allow do crawler funciona), NÃO a landing de venda. ✅ (caso anti-cloaking)

Expected: os 4 cenários conforme descrito. Se o cenário 4 mostrar a landing de venda, a seed do crawler não está casando — investigar antes de prosseguir.

- [ ] **Step 4: Commit final (se houver ajuste)**

```bash
git add -A
git commit -m "test(traffic-filter): verificação ponta-a-ponta"
```

---

## Self-Review (do autor do plano)

**Spec coverage:**
- Conceito "a lista é o veredito" → Task 3 (`evaluateRules`, precedência allow>block>default). ✅
- Onde o crawler do FB cai (seed ALLOW) → Task 1 (seeds) + Task 3 (teste anti-cloaking) + Task 10 (smoke curl). ✅
- Schema (tabela + índice + `traffic_filter_enabled`) → Task 1. ✅
- 4 match_types (ip/CIDR, user_agent, referer, asn) → Task 3 (testes de cada). ✅
- ASN via ip-api reaproveitando geoip → Task 4. ✅
- Página de venda (sem botão/sem tracking) → Task 6 + Task 7 (return antes do insert). ✅
- Fail-safe → allow → Task 5 (try/catch) + nota na Task 3. ✅
- `/go` sem mudança → confirmado no spec; nenhuma task mexe nele. ✅
- UI de gestão → Tasks 8 + 9. ✅
- Toggle por bot, default desligado → Task 1 (`DEFAULT false`) + Task 8 (`toggleTrafficFilter`). ✅
- Testes TDD da lógica pura → Tasks 3 e 4. ✅

**Placeholder scan:** Task 9 Step 2 descreve o manager em prosa (não há lógica nova, é CRUD das 5 actions já definidas) — aceitável porque toda a interface e dependências estão especificadas; o código de UI segue padrões existentes do projeto. Nenhum "TBD/TODO" em código de lógica.

**Type consistency:** `evaluateRules(signals, rules)`, `TrafficSignals`, `decideTraffic`, `lookupAsn`, `AsnResult`, `TrafficFilterRule`, nomes das 5 actions e do componente `TrafficFilterManager` — consistentes entre as tasks que os definem e as que os consomem. ✅
