# Filtro de Tráfego (Allowlist / Blocklist) — LionBot

**Data:** 2026-06-26
**Status:** Aprovado (design), aguardando plano de implementação

## Problema

A página de clique `/t` (a "página de redirect") hoje mostra a oferta do bot para
qualquer visitante. Concorrentes que espionam ofertas ativas pela Biblioteca de
Anúncios (Ad Library) do Facebook conseguem ver e clonar a oferta. O concorrente
Sharkbot resolve isso com um **filtro de tráfego**: quando detecta um visitante que
não é um clique de anúncio legítimo (espião / scraper / acesso direto), em vez de
mostrar a oferta, manda o visitante para uma **landing vendendo o próprio produto**.

O LionBot quer o mesmo: transformar o tráfego "ruim" (espião) em oportunidade de
marketing, enquanto a oferta real só aparece para quem clicou no anúncio.

## Objetivo

- Proteger a oferta: só quem é tráfego legítimo (clique real de anúncio, ou
  explicitamente permitido) vê a página `/t` real com o botão para o Telegram.
- Espião humano (Ad Library, sem fbclid, datacenter/VPN) cai numa página
  **"Conheça o LionBot"** — não vê a oferta, não vê o botão, não gera tracking.
- **Sem cloaking acidental:** o crawler de revisão do Facebook
  (`facebookexternalhit`) precisa SEMPRE ver a página `/t` real, senão o anúncio é
  reprovado / a conta é banida. Isso é garantido por uma regra ALLOW explícita.

## Conceito central: a lista é o veredito

O sistema é uma **allowlist / blocklist explícita** (tabela `traffic_filter_rules`).
A lista é a fonte da verdade — não há score escondido. Mover uma entrada entre
allow/block (ou ativar/desativar) muda o comportamento imediatamente.

**Precedência de avaliação (primeiro que casar vence):**

1. Regra **ALLOW** explícita que casa → veredito `allow` (vê `/t` real).
2. Regra **BLOCK** explícita que casa → veredito `block` (vê página de venda).
3. Nenhuma regra explícita casa → **default por sinal**:
   - tem `fbclid` válido → `allow` (clique real de anúncio)
   - sem `fbclid` (browser humano) → `block`
   - IP de hosting/proxy/datacenter (ASN) → `block`
   - referer da Ad Library → `block`

ALLOW sempre vence BLOCK. Regra explícita sempre vence default-por-sinal. É isso que
garante: "se o cara da Ad Library for adicionado à allowlist, ele vê a página normal".

### Onde o crawler do Facebook cai

O crawler do FB cai numa **regra ALLOW explícita** (`match_type: user_agent`,
`value: facebookexternalhit`), criada como **seed** da migration. Como ALLOW é
avaliado antes de qualquer default-por-sinal, ele é interceptado no passo 1 e vê a
`/t` real — mesmo chegando sem fbclid. Ele aparece na UI de gestão (com note "crawler
FB") e está sob controle do usuário como qualquer outra entrada da lista.

| Quem | Lista | Como casa | Vê |
|---|---|---|---|
| Crawler do FB | **allow** | regra explícita `user_agent` (seed) | `/t` real |
| Clique de anúncio real | allow | default-por-sinal (tem fbclid) | `/t` real |
| Espião da Ad Library | block | default-por-sinal (referer) ou regra | venda do LionBot |
| Humano sem fbclid | block | default-por-sinal | venda do LionBot |
| Datacenter/VPN | block | default-por-sinal (ASN/hosting) | venda do LionBot |

## Fluxo na `/t` (a cada clique)

```
Visitante chega na /t
   │
   ├─ 1. Coleta sinais: IP, User-Agent, referer, fbclid, + ASN/hosting (ip-api.com)
   │
   ├─ 2. evaluate() → match() retorna veredito 'allow' | 'block'
   │       a) ALLOW explícito casa?  → allow
   │       b) BLOCK explícito casa?  → block
   │       c) default-por-sinal (fbclid / hosting / ad-library / sem-fbclid)
   │
   ├─ 3a. allow → renderiza /t normal (botão Telegram, grava tracking_event)
   └─ 3b. block → renderiza <LionBotSalesPage/> (sem botão, sem tracking)
```

## Schema

Migration `043_traffic_filter_rules.sql`:

```sql
CREATE TABLE public.traffic_filter_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  list        text NOT NULL CHECK (list IN ('allow','block')),
  match_type  text NOT NULL CHECK (match_type IN ('ip','user_agent','referer','asn')),
  value       text NOT NULL,
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tfr_lookup
  ON public.traffic_filter_rules (tenant_id, is_active, list, match_type);
```

- **Por tenant** — segue o padrão multi-tenant do projeto (`tracking_events`).
- `match_type`: `ip` (single/CIDR), `user_agent` (substring), `referer` (substring),
  `asn` (ex: `AS16509`).
- `is_active` — desliga a regra sem apagar (a "saída" da lista).
- **Seeds** (allow / user_agent): `facebookexternalhit`, `facebookcatalog`,
  `meta-externalagent` — garantem que o crawler revisor sempre veja a página real.
- Coluna nova em `bots`: `traffic_filter_enabled boolean NOT NULL DEFAULT false` —
  toggle por bot. Começa **desligado**; usuário ativa quando pronto. Bots existentes
  não são afetados.

## Componentes & arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/043_traffic_filter_rules.sql` | Tabela + índice + seeds + coluna `bots.traffic_filter_enabled` |
| `lib/traffic-filter/match.ts` | **Lógica pura, testável**: (sinais + regras) → `'allow' \| 'block'`. Zero I/O. |
| `lib/traffic-filter/evaluate.ts` | Orquestra: busca regras (Supabase) + ASN (ip-api) + chama `match()`. Fail-safe → `allow`. |
| `lib/traffic-filter/asn-lookup.ts` | ip-api com `fields=...,proxy,hosting,as`. Cache em memória por IP + timeout curto. |
| `app/t/page.tsx` | Chama `evaluate()`. `block` → renderiza `<LionBotSalesPage/>`, sem botão `/go`, sem `tracking_events.insert`. |
| `components/traffic-filter/lion-bot-sales-page.tsx` | Landing "Conheça o LionBot" (paleta synthwave magenta/cyan da `/t`). |
| `app/dashboard/.../traffic-filter/page.tsx` | UI de gestão das listas (add/remove/ativar regra). Padrão das telas admin. |

## Detecção de ASN/datacenter

Reaproveita o `ip-api.com` já integrado em `server/src/services/geoip.ts`. O free
tier retorna `proxy`, `hosting` e `as` (ASN) — basta adicioná-los aos `fields`. Segue
o mesmo padrão de timeout curto + fail-safe (`return {}` em qualquer erro). Cache em
memória por IP para não repetir lookup no mesmo clique/sessão.

## Página de venda do LionBot

Landing própria no padrão visual synthwave magenta/cyan já usado na `/t` (reaproveita
a paleta `C`). Headline tipo "Crie seu próprio bot de vendas no Telegram", benefícios,
CTA. **Não expõe** o bot do cliente, **não** tem botão `/go`, **não** grava tracking.
O `<title>` permanece neutro (mesma estratégia anti-bloqueio da `/t`).

## Erros & fail-safe

Princípio: **o filtro nunca pode derrubar um clique pago legítimo.** Qualquer falha
(Supabase indisponível, ip-api timeout/rate-limit) → veredito **`allow`**. Segue o
best-effort do `geoip.ts`.

`/go` não precisa de mudança: já exige `tid` válido vindo da `/t`; como o espião nunca
recebe um botão com `tid`, não há o que ele chamar.

## Testes (TDD)

`match.ts` é função pura → bateria de testes de tabela:
- cada `match_type` (ip/CIDR, user_agent, referer, asn)
- precedência: allow vence block; regra explícita vence default-por-sinal
- cada default-por-sinal (fbclid presente=allow; sem fbclid/hosting/ad-library=block)
- **caso crítico:** `facebookexternalhit` na allowlist → `allow` (anti-cloaking)

Sem mocks de rede (a lógica pura não faz I/O).

## Fora de escopo (YAGNI)

- Score ponderado de sinais (a lista explícita + defaults cobrem o caso).
- Contagem de cliques repetidos por IP (não foi priorizado; pode virar regra `ip` manual).
- Desafio JS no browser (latência extra no fluxo humano; defaults + ASN já cobrem).
- Bloqueio por país/idioma (objetivo é anti-clonagem, não geo-targeting).
