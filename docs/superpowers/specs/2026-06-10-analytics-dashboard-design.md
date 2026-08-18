# Telas Dashboard + Análises (LionBot) — Design

**Data:** 2026-06-10
**Status:** Em aprovação
**Origem:** prints de um dashboard de analytics da concorrência que o usuário quer recriar no LionBot.

---

## 1. Objetivo

Construir **duas telas novas** de analytics, inspiradas nos prints da concorrência, mas com **layout autoral LionBot** (bento grid synthwave, não cópia 1:1) e **dados reais do Supabase** onde existir fonte. Widgets sem fonte de dado viram **placeholder "em breve"** com a estética synthwave — **sem tocar no backend / sem migration**.

### Telas
1. **`/dashboard` (home)** — visão-resumo: faturamento, KPIs principais, gráfico de receita, atividade recente.
2. **`/dashboard/analytics` (Análises)** — painel denso: filtros + ~25 widgets de métricas.

> Hoje `/dashboard` só mostra `OverviewStats` (4 cards) + grid de `BotCard`. A home nova **vira um dashboard de verdade**; o grid de bots vira uma seção dentro dela (ou um link). A tela Análises é nova (`/dashboard/analytics`).

### Não-objetivos (YAGNI)
- Nenhuma migration. Nenhuma mudança em `server/`.
- Não capturar IP/device/geo (exige backend) → esses widgets são placeholder.
- Não criar gamificação (players/badges/meta) → placeholder.
- Não fazer cópia pixel-perfect dos prints — layout é autoral LionBot.

---

## 2. Fontes de dado reais (confirmadas no schema)

| Tabela | Colunas-chave |
|---|---|
| `transactions` | `tenant_id, lead_id, bot_id, flow_id, product_id, gateway, amount` (int, **centavos**), `status` (pending/approved/refused/refunded), `paid_at, created_at` |
| `tracking_events` | `event_type` (page_view/bot_start/view_offer/checkout/purchase), `utm_params` (jsonb), `event_data` (jsonb), `lead_id, bot_id, created_at` |
| `leads` | `tenant_id, bot_id, username, utm_source, utm_campaign, created_at, updated_at` (validar nomes exatos) |
| `bots` | `id, bot_username, redirect_display_name, payment_gateway` |
| `flows` | `id, name` |
| `products` | `id, name, price` |

RLS isola por `tenant_id` — todas as queries já vêm filtradas pelo tenant logado.

---

## 3. Classificação dos widgets (do gap analysis)

### ✅ Dados reais (construir já)
**Análises:** Filtros (Bots/Fluxos/Gateways/Fontes/Período), Visitas, Starts %, Calendário (UI), Vendas por Dia da Semana, Top 5 Bots/Fluxos/Planos/Tickets/7-dias, Top Campanhas, Top Fontes, Tempo médio start→pagamento, Taxa Recorrência, LTV Médio, Vendas por Usuário, Funil de Conversão (/start→checkout→purchase).
**Dashboard:** Faturamento, Vendas Aprovadas (R$+%+barra), Total Starts, Starts/Venda, Ticket Médio, Gráfico receita 7d, Saudação+nome+data, Log de Atividades (derivado de `created_at` de leads/transactions).

### 🟡 Query nova / proxy (definir semântica primeiro)
Taxa de Conversão (gauge = checkout/bot_start), Vendas por Hora (pagos via transactions; "gerados" = checkout), Receita Gerada vs Confirmada, Taxa Abandono (checkout sem purchase), Taxa Recuperação (cruzar remarketing_progress×transactions), Taxa Retenção, Contadores por tipo de usuário.

**Definição FIXADA (aprovada pelo usuário 2026-06-10):** **"PIX gerado" = `tracking_events.event_type='checkout'`**; **"PIX pago" = `transactions.status='approved'`**.

### 🔴 Sem dado → placeholder "em breve"
Meta de faturamento, Premiações/badges, Top 5 Players, Top Códigos de Venda, Top Posicionamentos, Geolocalização (mapa BR + estados + Top Cidades), Dispositivos, Taxa Upsell/Downsell/OrderBump/Upgrade, Diário de Mudanças.

Placeholder = card synthwave com o título/ícone real + overlay sutil "Em breve" (badge) + estado vazio elegante (não dado falso). Mantém o layout completo das telas sem enganar com número inventado.

---

## 4. Arquitetura técnica

### Camada de dados (server-side, sem migration)
Nova action file: `lib/actions/analytics-actions.ts` — funções `"use server"` que rodam as agregações via Supabase. Cada uma recebe `{ period, botId?, flowId?, gateway?, source? }` e retorna dados tipados. Reusar padrões de `transaction-actions.ts` / `tracking-actions.ts` existentes.

Funções (fase 1-3):
- `getRevenueStats(filters)` → faturamento, vendas aprovadas, % aprovação, ticket médio, LTV, recorrência.
- `getFunnelStats(filters)` → page_view→bot_start→checkout→purchase (counts + %).
- `getTopBreakdowns(filters)` → top bots/fluxos/planos/tickets/campanhas/fontes (GROUP BY).
- `getTimeSeries(filters)` → receita por dia (7d), por dia-da-semana, por hora.
- `getActivityFeed()` → últimos N leads+transactions ordenados por created_at (derivado).

Período: helper de range de datas (Hoje/Ontem/7d/30d/Total) — converter pra `created_at >= X`.

### Camada de UI
- **`app/dashboard/page.tsx`** — vira a home-dashboard (server component que chama as actions e passa pros componentes).
- **`app/dashboard/analytics/page.tsx`** — nova rota da tela Análises.
- **`components/dashboard/analytics/`** — novos componentes: `kpi-card.tsx`, `gauge.tsx`, `revenue-chart.tsx`, `funnel.tsx`, `top-list.tsx`, `weekday-chart.tsx`, `hour-chart.tsx`, `activity-feed.tsx`, `filter-bar.tsx`, `coming-soon-card.tsx` (placeholder), etc.
- **Gráficos:** sem lib pesada nova — SVG/CSS puro (barras, linha, gauge, funil) na estética synthwave, consistente com o resto. (Decisão: evitar recharts/chart.js; manter bundle leve. Reavaliar se algum gráfico ficar inviável em SVG puro.)
- **Layout:** bento grid (CSS grid com spans variados) usando as classes `.card`/`.card-glow`/tokens synthwave já existentes. Densidade de "HUD de dados".

### Navegação
Adicionar item **"Análises"** na sidebar (já existe `components/dashboard/sidebar.tsx`). A home `/dashboard` é o "Painel".

---

## 5. Layout autoral (bento) — esboço

**Dashboard (home):**
```
┌─ topbar: saudação+nome+data ──────────────── [meta: placeholder] ┐
├─ KPI strip: [Vendas Aprov.] [Conversão] [Starts] [Ticket] ──────┤
├─ Receita 7 dias (gráfico linha, largura 2/3) ─┬─ Atividade (1/3)─┤
├─ Top Bots ─┬─ Top Fluxos ─┬─ Funil ───────────┴──────────────────┤
└─ [Players: placeholder] ─ [Premiações: placeholder] ─────────────┘
```

**Análises:**
```
┌─ título "Análises" ───────────────── [período: Hoje/Ontem/7d/Mês/Tudo] ┐
├─ filtros: [Bots][Fluxos][Gateways][Fontes][Tipos]  [limpar] ──────────┤
├─ KPI strip: [Visitas][Starts %][Receita Gerada][Receita Confirmada] ──┤
├─ Vendas por Hora (2/3) ─────────────────┬─ Calendário (1/3) ──────────┤
├─ Vendas por Dia da Semana (full) ───────┴─────────────────────────────┤
├─ Top Bots ─ Top Fluxos ─ Top Planos ─ Top 7 dias (4 col) ─────────────┤
├─ Top Tickets ─ [Top Códigos: placeholder] ─ Funil (2/3) ──────────────┤
├─ Top Campanhas ─ Top Fontes ─ [Posicionamentos: ph] ─ Tempo Médio ────┤
├─ [Geo: placeholder] ─ [Top Cidades: ph] ─ [Dispositivos: ph] ─────────┤
├─ [Taxas Upsell/Down/Bump/Recup: ph/🟡] ─ Recorrência ─ Retenção 🟡 ───┤
├─ LTV ─ Vendas por Usuário ─ Tempo Retorno 🟡 ─ Contadores 🟡 ─────────┤
└─ [Diário de Mudanças: placeholder] ──────────────────────────────────┘
```

---

## 6. Ordem de implementação (fases)

1. **Infra de dados** — `analytics-actions.ts` + helper de período + tipos.
2. **Fase 1 — Análises (✅):** filtros, KPI strip, Top 5s, Vendas por Dia da Semana, Funil, LTV/Recorrência/Vendas-por-usuário, Tempo médio. Dados reais.
3. **Fase 2 — Dashboard home (✅):** KPI strip, gráfico 7d, atividade derivada, saudação. (Superset enxuto da fase 1.)
4. **Fase 3 — 🟡:** fixar "PIX gerado=checkout", ligar gauge conversão, Vendas por Hora, Receita Gerada/Confirmada, Abandono, Retenção, Contadores.
5. **Fase 4 — 🔴 placeholders:** todos os "em breve" com a cara synthwave.
6. **Navegação + polish + verificação** (build/lint/smoke a cada fase).

Trabalho em **git worktree isolado** (não bagunça a `main` que deploya na Vercel). Merge só no fim de cada fase aprovada.

---

## 7. Verificação

- `npm run build` + `npm run lint` limpos a cada fase (sem novos erros vs baseline).
- Smoke test: `/dashboard` e `/dashboard/analytics` retornam 200 e renderizam.
- Conferir que números batem com os dados reais (cruzar com transactions/leads conhecidos).
- Nenhum arquivo em `server/` tocado; nenhuma migration nova.

---

## 8. Riscos / decisões em aberto

- ~~**Semântica "PIX gerado"**~~ — RESOLVIDO: `checkout`.
- **Gráficos em SVG puro** vs lib — se algum ficar inviável (ex.: mapa do Brasil), o mapa já é placeholder mesmo, então sem risco.
- **Volume de queries** na tela Análises (muitos widgets) — agrupar em poucas actions que retornam vários números de uma vez, e usar `Promise.all` (padrão já usado no projeto). Evitar N+1.
- **Nomes exatos de colunas de `leads`** (utm_source/utm_campaign/username) — validar na implementação antes de usar.
