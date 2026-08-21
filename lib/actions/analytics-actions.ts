"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Analytics aggregations for the Dashboard (home) and Análises screens.
 *
 * Design notes:
 * - RLS isolates every query by the logged-in tenant, so we don't pass tenant_id.
 * - `amount` is stored in integer cents; we aggregate in JS (Supabase JS has no SUM).
 * - "PIX gerado" = tracking_events.event_type='checkout'; "PIX pago" = transactions.status='approved'.
 * - No migrations / no backend changes — read-only aggregations over existing tables.
 */

export type Period = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

export interface AnalyticsFilters {
  period?: Period;
  /** ISO date YYYY-MM-DD (só usado quando period === "custom") */
  startDate?: string;
  endDate?: string;
  botId?: string;
  flowId?: string;
  gateway?: string;
  source?: string;
  /** Admin: restringe a um único usuário (tenant). null/undefined = todos. */
  viewTenantId?: string | null;
}

// Fuso de referência do negócio (Brasil = UTC-3). created_at é gravado em UTC;
// o "dia" do usuário é no horário de Brasília, então convertemos explicitamente
// (não dependemos do fuso do servidor, que na VPS costuma ser UTC).
const BR_OFFSET_MIN = 180; // UTC-3 → +180 min pra ir de BRT pra UTC

/** Início do dia (00:00 BRT) de "hoje", como Date em UTC. */
function startOfTodayBR(): Date {
  const now = new Date();
  // "agora" deslocado pra BRT, pegamos a data-calendário em BRT
  const br = new Date(now.getTime() - BR_OFFSET_MIN * 60_000);
  // meia-noite BRT daquele dia, de volta em UTC
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate(), 0, 0, 0) + BR_OFFSET_MIN * 60_000);
}

/** Resolve a period into an inclusive ISO start (and optional exclusive end). */
function periodRange(
  period: Period = "today",
  startDate?: string,
  endDate?: string,
): { start: string | null; end: string | null } {
  const startOfToday = startOfTodayBR();
  const DAY = 86_400_000;

  switch (period) {
    case "today":
      return { start: startOfToday.toISOString(), end: null };
    case "yesterday": {
      const y = new Date(startOfToday.getTime() - DAY);
      return { start: y.toISOString(), end: startOfToday.toISOString() };
    }
    case "7d": {
      const s = new Date(startOfToday.getTime() - 6 * DAY); // últimos 7 dias incl. hoje
      return { start: s.toISOString(), end: null };
    }
    case "30d": {
      const s = new Date(startOfToday.getTime() - 29 * DAY);
      return { start: s.toISOString(), end: null };
    }
    case "custom": {
      // [startDate 00:00 BRT, endDate+1 00:00 BRT) — inclui o dia final
      if (!startDate || !endDate) return { start: null, end: null };
      const sd = startDate.split("-").map(Number);
      const ed = endDate.split("-").map(Number);
      if (sd.length !== 3 || ed.length !== 3 || sd.some(isNaN) || ed.some(isNaN)) return { start: null, end: null };
      const s = new Date(Date.UTC(sd[0], sd[1] - 1, sd[2], 0, 0, 0) + BR_OFFSET_MIN * 60_000);
      const e = new Date(Date.UTC(ed[0], ed[1] - 1, ed[2], 0, 0, 0) + BR_OFFSET_MIN * 60_000 + DAY);
      return { start: s.toISOString(), end: e.toISOString() };
    }
    case "all":
    default:
      return { start: null, end: null };
  }
}

/**
 * Apply period + bot filters to a Supabase query builder.
 * Typed as `any` on purpose: the PostgrestFilterBuilder generics are too deep to
 * thread through a generic helper (TS2589). This mirrors the project's existing
 * `let q = ...; q = q.eq(...)` pattern. The query result is still validated where consumed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, filters: AnalyticsFilters, opts?: { createdCol?: string }): any {
  const { start, end } = periodRange(filters.period, filters.startDate, filters.endDate);
  const col = opts?.createdCol ?? "created_at";
  let q = query;
  if (start) q = q.gte(col, start);
  if (end) q = q.lt(col, end);
  if (filters.botId) q = q.eq("bot_id", filters.botId);
  // Admin vendo 1 usuário específico: restringe ao tenant. (RLS não restringe
  // admin, então o filtro explícito é o que separa "minha"/"por usuário".)
  if (filters.viewTenantId) q = q.eq("tenant_id", filters.viewTenantId);
  return q;
}

/**
 * Filtros para a tabela TRANSACTIONS: período + bot + flow + gateway.
 * (source não vive em transactions — é resolvido via lead_id, ver resolveSourceLeadIds.)
 * Use isto em TODA query de transactions pra os cards seguirem os filtros.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTxFilters(query: any, filters: AnalyticsFilters): any {
  let q = applyFilters(query, filters);
  if (filters.flowId) q = q.eq("flow_id", filters.flowId);
  if (filters.gateway) q = q.eq("gateway", filters.gateway);
  return q;
}

/**
 * Aplica o filtro de FONTE a uma query de tracking_events (que tem utm_params).
 * A fonte é gravada em utm_params.utm_source (NÃO em .source).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyEventSource(query: any, filters: AnalyticsFilters): any {
  if (filters.source) return query.eq("utm_params->>utm_source", filters.source);
  return query;
}

/**
 * Resolve os lead_ids de uma fonte (leads.utm_source = source), paginado.
 * Usado pra filtrar transactions por fonte (que não tem a coluna utm_source).
 * Retorna [] se a fonte não tem leads → o chamador deve tratar como "sem resultados".
 */
async function resolveSourceLeadIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  source: string,
): Promise<string[]> {
  const rows = await fetchAllPaged<{ id: string }>(() =>
    supabase.from("leads").select("id").eq("utm_source", source).order("id", { ascending: true }),
  );
  return rows.map((r) => r.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paginação — o Supabase corta toda query em 1000 linhas. Sem isto, qualquer
// agregação sobre tabela grande (transactions 10k+, leads 24k+, tracking 4k+)
// subconta. Regra: filtrar TUDO no servidor (status/event_type/período) ANTES.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca TODAS as linhas de um builder já filtrado, em lotes de 1000.
 * `buildQuery` é uma FACTORY: cria um builder NOVO a cada lote — o
 * PostgrestFilterBuilder é thenable de uso único, não pode ser reusado após await.
 * Os builders devem ter um `.order(...)` estável (passado pelo chamador) pra a
 * paginação não pular/repetir linhas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged<T>(buildQuery: () => any, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await buildQuery().range(from, from + page - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < page) break; // última página
  }
  return out;
}

/** Contagem EXATA no servidor sem trazer linhas. buildQuery deve usar
 *  .select("*", { count: "exact", head: true }). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countRows(buildQuery: () => any): Promise<number> {
  const { count } = await buildQuery();
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue / sales KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueStats {
  /** approved revenue in cents */
  revenue: number;
  /** gross revenue (all non-refused transactions) in cents — "receita gerada" */
  grossRevenue: number;
  /** count of approved transactions */
  sales: number;
  /** total transactions in range (any status) */
  totalTx: number;
  /** approved / total, 0..1 */
  approvalRate: number;
  /** average approved ticket in cents */
  avgTicket: number;
  /** distinct buyers (lead_id with ≥1 approved) */
  buyers: number;
  /** lifetime value avg: revenue / buyers, in cents */
  ltv: number;
  /** sales per buyer */
  salesPerBuyer: number;
  /** recurrence rate: buyers with ≥2 approved / buyers, 0..1 */
  recurrenceRate: number;
}

export async function getRevenueStats(filters: AnalyticsFilters = {}): Promise<RevenueStats> {
  const supabase = await createClient();

  // Filtro de fonte: transactions não tem utm_source → resolve os lead_ids da
  // fonte e restringe por lead_id. Lista vazia = nenhum lead → resultado vazio
  // (NÃO ignorar o filtro, senão "vazio" viraria "tudo").
  const sourceLeadIds = filters.source ? await resolveSourceLeadIds(supabase, filters.source) : null;

  // helper: aplica TODOS os filtros (period+bot+flow+gateway+source) + order estável.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txBuilder = (sel: string, count = false): any => {
    let q = count
      ? supabase.from("transactions").select(sel, { count: "exact", head: true })
      : supabase.from("transactions").select(sel).order("id", { ascending: true });
    q = applyTxFilters(q, filters);
    if (sourceLeadIds) {
      q = sourceLeadIds.length > 0 ? q.in("lead_id", sourceLeadIds) : q.eq("lead_id", "00000000-0000-0000-0000-000000000000");
    }
    return q;
  };

  // APROVADAS (paginadas): receita, vendas, buyers, recorrência. Filtra status no
  // servidor → traz só as ~1.1k aprovadas, não as 10k+ de qualquer status.
  const approved = await fetchAllPaged<{ amount: number; lead_id: string | null }>(
    () => txBuilder("amount,lead_id").eq("status", "approved"),
  );
  // RECEITA BRUTA (não recusadas/estornadas) — também paginada.
  const grossRows = await fetchAllPaged<{ amount: number }>(
    () => txBuilder("amount").not("status", "in", "(refused,refunded)"),
  );
  // totalTx (qualquer status) — contagem exata, sem trazer linhas.
  const totalTx = await countRows(() => txBuilder("*", true));

  const revenue = approved.reduce((s, t) => s + (t.amount ?? 0), 0);
  const grossRevenue = grossRows.reduce((s, t) => s + (t.amount ?? 0), 0);
  const sales = approved.length;
  const approvalRate = totalTx > 0 ? sales / totalTx : 0;
  const avgTicket = sales > 0 ? Math.round(revenue / sales) : 0;

  const buyerCounts = new Map<string, number>();
  for (const t of approved) {
    if (!t.lead_id) continue;
    buyerCounts.set(t.lead_id, (buyerCounts.get(t.lead_id) ?? 0) + 1);
  }
  const buyers = buyerCounts.size;
  const ltv = buyers > 0 ? Math.round(revenue / buyers) : 0;
  const salesPerBuyer = buyers > 0 ? sales / buyers : 0;
  const recurring = [...buyerCounts.values()].filter((c) => c >= 2).length;
  const recurrenceRate = buyers > 0 ? recurring / buyers : 0;

  return { revenue, grossRevenue, sales, totalTx, approvalRate, avgTicket, buyers, ltv, salesPerBuyer, recurrenceRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracking KPIs (visits, starts, funnel)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackingStats {
  visits: number; // page_view
  starts: number; // bot_start
  checkouts: number; // checkout (PIX gerado)
  purchases: number; // purchase
  startRate: number; // starts / visits
  startsPerSale: number; // starts / approved sales (passed in)
}

export async function getTrackingStats(filters: AnalyticsFilters = {}, approvedSales = 0): Promise<TrackingStats> {
  const supabase = await createClient();

  // contagem EXATA por event_type no servidor (sem trazer linhas → sem limite de 1000).
  const evCount = (type: string) =>
    countRows(() => {
      let q = supabase.from("tracking_events").select("*", { count: "exact", head: true }).eq("event_type", type);
      q = applyFilters(q, filters);
      q = applyEventSource(q, filters);
      return q;
    });

  const [visits, starts, checkouts, purchases] = await Promise.all([
    evCount("page_view"),
    evCount("bot_start"),
    evCount("checkout"),
    evCount("purchase"),
  ]);

  return {
    visits,
    starts,
    checkouts,
    purchases,
    startRate: visits > 0 ? starts / visits : 0,
    startsPerSale: approvedSales > 0 ? starts / approvedSales : 0,
  };
}

export interface FunnelStats {
  starts: number;
  checkouts: number;
  paid: number;
  startToCheckout: number; // 0..1
  checkoutToPaid: number;
  startToPaid: number;
}

export async function getFunnelStats(filters: AnalyticsFilters = {}): Promise<FunnelStats> {
  const supabase = await createClient();

  // source em transactions (paid) → via lead_id, como em getRevenueStats.
  const sourceLeadIds = filters.source ? await resolveSourceLeadIds(supabase, filters.source) : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paidBuilder = (): any => {
    let q = applyTxFilters(supabase.from("transactions").select("*", { count: "exact", head: true }).eq("status", "approved"), filters);
    if (sourceLeadIds) q = sourceLeadIds.length > 0 ? q.in("lead_id", sourceLeadIds) : q.eq("lead_id", "00000000-0000-0000-0000-000000000000");
    return q;
  };

  // 3 contagens EXATAS no servidor (sem trazer linhas → sem limite de 1000).
  // starts/checkouts seguem source via utm_params (mesma chave de getTrackingStats).
  const [starts, checkouts, paid] = await Promise.all([
    countRows(() => applyEventSource(applyFilters(supabase.from("tracking_events").select("*", { count: "exact", head: true }).eq("event_type", "bot_start"), filters), filters)),
    countRows(() => applyEventSource(applyFilters(supabase.from("tracking_events").select("*", { count: "exact", head: true }).eq("event_type", "checkout"), filters), filters)),
    countRows(paidBuilder),
  ]);

  // clamp em 100%: paid (transactions) e starts/checkouts (tracking_events) vêm de
  // universos diferentes; uma venda sem bot_start rastreado faria a taxa passar de 100%.
  const clamp = (x: number) => Math.min(1, x);
  return {
    starts,
    checkouts,
    paid,
    startToCheckout: starts > 0 ? clamp(checkouts / starts) : 0,
    checkoutToPaid: checkouts > 0 ? clamp(paid / checkouts) : 0,
    startToPaid: starts > 0 ? clamp(paid / starts) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top breakdowns (bots / flows / products / campaigns / sources)
// ─────────────────────────────────────────────────────────────────────────────

export interface TopRow {
  id: string;
  label: string;
  revenue: number; // cents
  sales: number;
}

export async function getTopBreakdowns(filters: AnalyticsFilters = {}): Promise<{
  bots: TopRow[];
  flows: TopRow[];
  products: TopRow[];
  campaigns: TopRow[];
  sources: TopRow[];
}> {
  const supabase = await createClient();

  // source → resolve lead_ids (transactions não tem utm_source).
  const sourceLeadIds = filters.source ? await resolveSourceLeadIds(supabase, filters.source) : null;

  // aprovadas (paginadas, status no servidor) com os joins + TODOS os filtros.
  const approved = await fetchAllPaged<Record<string, unknown>>(() => {
    let q = applyTxFilters(
      supabase
        .from("transactions")
        .select("amount,status,bot_id,flow_id,product_id,lead_id, bots(bot_username,redirect_display_name), flows(name), products(name,ghost_name)")
        .eq("status", "approved")
        .order("id", { ascending: true }),
      filters,
    );
    if (sourceLeadIds) q = sourceLeadIds.length > 0 ? q.in("lead_id", sourceLeadIds) : q.eq("lead_id", "00000000-0000-0000-0000-000000000000");
    return q;
  });

  // Aggregate generic helper
  function agg<T extends Record<string, unknown>>(
    rows: T[],
    keyOf: (r: T) => string | null | undefined,
    labelOf: (r: T) => string,
  ): TopRow[] {
    const map = new Map<string, TopRow>();
    for (const r of rows) {
      const id = keyOf(r);
      if (!id) continue;
      const cur = map.get(id) ?? { id, label: labelOf(r), revenue: 0, sales: 0 };
      cur.revenue += (r.amount as number) ?? 0;
      cur.sales += 1;
      map.set(id, cur);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }

  type Row = {
    amount: number;
    bot_id: string;
    flow_id: string | null;
    product_id: string;
    bots?: { bot_username?: string; redirect_display_name?: string | null } | null;
    flows?: { name?: string } | null;
    products?: { name?: string; ghost_name?: string | null } | null;
  };
  const rows = approved as unknown as Row[];

  const bots = agg(rows, (r) => r.bot_id, (r) => r.bots?.redirect_display_name || r.bots?.bot_username || "Bot");
  const flows = agg(rows, (r) => r.flow_id, (r) => r.flows?.name || "Fluxo");
  const products = agg(rows, (r) => r.product_id, (r) => r.products?.ghost_name || r.products?.name || "Plano");

  // campaigns / sources come from leads joined via lead_id
  const leadIds = [...new Set(rows.map((r) => (r as unknown as { lead_id?: string }).lead_id).filter(Boolean))] as string[];
  let campaigns: TopRow[] = [];
  let sources: TopRow[] = [];
  if (leadIds.length > 0) {
    // chunk de 500 ids por query (.in com muitos ids estoura a URL + corta em 1000).
    const leadMap = new Map<string, { id: string; utm_campaign?: string; utm_source?: string }>();
    for (let i = 0; i < leadIds.length; i += 500) {
      const chunk = leadIds.slice(i, i + 500);
      const { data: leads } = await supabase.from("leads").select("id,utm_campaign,utm_source").in("id", chunk);
      for (const l of leads ?? []) leadMap.set(l.id as string, l as { id: string; utm_campaign?: string; utm_source?: string });
    }
    const withLead = rows.map((r) => ({
      ...r,
      _lead: leadMap.get((r as unknown as { lead_id: string }).lead_id),
    }));
    campaigns = agg(
      withLead,
      (r) => (r._lead?.utm_campaign as string) || null,
      (r) => (r._lead?.utm_campaign as string) || "—",
    );
    sources = agg(
      withLead,
      (r) => (r._lead?.utm_source as string) || null,
      (r) => (r._lead?.utm_source as string) || "—",
    );
  }

  return { bots, flows, products, campaigns, sources };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time series (revenue per day, per weekday, per hour)
// ─────────────────────────────────────────────────────────────────────────────

export interface DayPoint {
  date: string; // YYYY-MM-DD
  revenue: number; // cents
  sales: number;
  /** rótulo curto p/ o eixo X (ex: "14h"). Se ausente, usa o dia-da-semana. */
  label?: string;
  /** rótulo completo p/ o tooltip (ex: "14:00–15:00"). Se ausente, usa a data. */
  fullLabel?: string;
}

/** Dia-calendário (YYYY-MM-DD) de um ISO UTC, no fuso de Brasília. */
function brDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() - BR_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export async function getRevenue7d(): Promise<DayPoint[]> {
  const supabase = await createClient();
  const { start } = periodRange("7d");
  // paginado + status no servidor (não corta em pico de vendas).
  const rows = await fetchAllPaged<{ amount: number; created_at: string }>(() => {
    let q = supabase.from("transactions").select("amount,created_at").eq("status", "approved").order("id", { ascending: true });
    if (start) q = q.gte("created_at", start);
    return q;
  });

  // buckets dos últimos 7 dias EM HORÁRIO DE BRASÍLIA (consistente com periodRange).
  const buckets = new Map<string, DayPoint>();
  const todayStart = startOfTodayBR();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * 86_400_000);
    const key = brDateKey(d.toISOString());
    buckets.set(key, { date: key, revenue: 0, sales: 0 });
  }
  for (const t of rows) {
    const b = buckets.get(brDateKey(t.created_at));
    if (b) {
      b.revenue += t.amount ?? 0;
      b.sales += 1;
    }
  }
  return [...buckets.values()];
}

export interface WeekdayPoint {
  weekday: number; // 0=Sun..6=Sat
  current: number; // sales count this week
  previous: number; // sales count last week
}

export async function getSalesByWeekday(filters: AnalyticsFilters = {}): Promise<{ points: WeekdayPoint[]; todayIdx: number }> {
  const supabase = await createClient();
  // semanas em horário de Brasília: início da semana atual e da anterior.
  const todayStart = startOfTodayBR();
  const dow = new Date(todayStart.getTime() - BR_OFFSET_MIN * 60_000).getUTCDay(); // 0=Dom..6=Sáb (BRT)
  const startOfWeek = new Date(todayStart.getTime() - dow * 86_400_000);
  const startOfPrevWeek = new Date(startOfWeek.getTime() - 7 * 86_400_000);

  // só precisamos das 2 últimas semanas → janela de 14d, paginada, status no servidor.
  const rows = await fetchAllPaged<{ created_at: string }>(() => {
    let q = supabase.from("transactions").select("created_at").eq("status", "approved")
      .gte("created_at", startOfPrevWeek.toISOString()).order("id", { ascending: true });
    // janela fixa de 14d é intencional (compara semana atual vs anterior); mas
    // segue as dimensões selecionadas (bot/flow/gateway).
    if (filters.botId) q = q.eq("bot_id", filters.botId);
    if (filters.flowId) q = q.eq("flow_id", filters.flowId);
    if (filters.gateway) q = q.eq("gateway", filters.gateway);
    if (filters.viewTenantId) q = q.eq("tenant_id", filters.viewTenantId);
    return q;
  });

  const points: WeekdayPoint[] = Array.from({ length: 7 }, (_, i) => ({ weekday: i, current: 0, previous: 0 }));
  for (const t of rows) {
    const d = new Date(t.created_at);
    const wd = new Date(d.getTime() - BR_OFFSET_MIN * 60_000).getUTCDay(); // weekday em BRT
    if (d >= startOfWeek) points[wd].current += 1;
    else if (d >= startOfPrevWeek) points[wd].previous += 1;
  }
  // todayIdx (dow) já está em BRT — o componente usa pra destacar a coluna de hoje.
  return { points, todayIdx: dow };
}

export interface HourPoint {
  hour: number; // 0..23
  generated: number; // checkout events
  paid: number; // approved tx
}

export async function getSalesByHour(filters: AnalyticsFilters = {}): Promise<HourPoint[]> {
  const supabase = await createClient();
  const { start } = periodRange("today");

  const [evRes, txRes] = await Promise.all([
    (() => {
      let q = supabase.from("tracking_events").select("event_type,created_at").eq("event_type", "checkout");
      if (start) q = q.gte("created_at", start);
      if (filters.botId) q = q.eq("bot_id", filters.botId);
      return q;
    })(),
    (() => {
      let q = supabase.from("transactions").select("created_at,status").eq("status", "approved");
      if (start) q = q.gte("created_at", start);
      if (filters.botId) q = q.eq("bot_id", filters.botId);
      return q;
    })(),
  ]);

  const points: HourPoint[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, generated: 0, paid: 0 }));
  for (const e of evRes.data ?? []) {
    const h = new Date(e.created_at as string).getHours();
    points[h].generated += 1;
  }
  for (const t of txRes.data ?? []) {
    const h = new Date(t.created_at as string).getHours();
    points[h].paid += 1;
  }
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity feed (derived from recent leads + transactions)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityItem {
  kind: "lead" | "pix" | "sale";
  title: string;
  detail: string;
  amount?: number; // cents
  at: string; // ISO
}

export async function getActivityFeed(limit = 12, viewTenantId?: string | null): Promise<ActivityItem[]> {
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => (viewTenantId ? q.eq("tenant_id", viewTenantId) : q);
  const [leadsRes, txRes] = await Promise.all([
    scoped(supabase.from("leads").select("first_name,username,created_at").order("created_at", { ascending: false }).limit(limit)),
    scoped(supabase.from("transactions").select("amount,status,created_at, products(name,ghost_name)").order("created_at", { ascending: false }).limit(limit)),
  ]);

  const items: ActivityItem[] = [];
  for (const l of leadsRes.data ?? []) {
    items.push({
      kind: "lead",
      title: "Novo Lead",
      detail: `${(l as { first_name?: string }).first_name || (l as { username?: string }).username || "Lead"} · iniciou conversa`,
      at: l.created_at as string,
    });
  }
  for (const t of txRes.data ?? []) {
    const prod = (t as unknown as { products?: { ghost_name?: string; name?: string } }).products;
    const isPaid = t.status === "approved";
    items.push({
      kind: isPaid ? "sale" : "pix",
      title: isPaid ? "Venda Aprovada" : "PIX Gerado",
      detail: prod?.ghost_name || prod?.name || "Produto",
      amount: t.amount as number,
      at: t.created_at as string,
    });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audience breakdown — devices + countries (from tracking_events.event_data)
//
// O page_view (rota /t) grava event_data.user_agent e event_data.country
// (cf-ipcountry da Cloudflare). Aqui agregamos esses dados que JÁ existem:
// device = classificação do user-agent; country = código ISO do país.
// ─────────────────────────────────────────────────────────────────────────────

export interface AudienceRow {
  id: string;
  label: string;
  count: number; // nº de page_views nesse bucket
  pct: number; // 0..1 sobre o total com dado disponível
}

/** Classifica um user-agent em mobile / tablet / desktop (sem dependência externa). */
function classifyDevice(ua: string | null | undefined): string {
  if (!ua) return "Desconhecido";
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return "Tablet";
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/.test(s)) return "Celular";
  if (/windows|macintosh|mac os|linux|cros|x11/.test(s)) return "Computador";
  if (/bot|crawler|spider|crawling/.test(s)) return "Bot/Crawler";
  return "Outro";
}

const COUNTRY_NAMES: Record<string, string> = {
  br: "Brasil", us: "Estados Unidos", pt: "Portugal", ar: "Argentina",
  mx: "México", es: "Espanha", cl: "Chile", co: "Colômbia", pe: "Peru",
  uy: "Uruguai", py: "Paraguai", gb: "Reino Unido", de: "Alemanha",
  fr: "França", it: "Itália", ca: "Canadá", angola: "Angola", ao: "Angola",
};

function countryLabel(code: string): string {
  const c = code.toLowerCase();
  return COUNTRY_NAMES[c] ?? code.toUpperCase();
}

export async function getAudienceBreakdown(filters: AnalyticsFilters = {}): Promise<{
  devices: AudienceRow[];
  countries: AudienceRow[];
  states: AudienceRow[];
}> {
  const supabase = await createClient();

  const rows = await fetchAllPaged<{
    event_data: { user_agent?: string; country?: string; state?: string } | null;
  }>(() =>
    applyEventSource(
      applyFilters(
        supabase.from("tracking_events").select("event_data").eq("event_type", "page_view").order("id", { ascending: true }),
        filters,
      ),
      filters,
    ),
  );

  const devMap = new Map<string, number>();
  const ctyMap = new Map<string, number>();
  const stMap = new Map<string, number>();
  let devTotal = 0;
  let ctyTotal = 0;
  let stTotal = 0;

  for (const r of rows) {
    const ed = r.event_data ?? {};
    const dev = classifyDevice(ed.user_agent);
    devMap.set(dev, (devMap.get(dev) ?? 0) + 1);
    devTotal += 1;

    const country = (ed.country ?? "").trim();
    if (country) {
      const key = country.toLowerCase();
      ctyMap.set(key, (ctyMap.get(key) ?? 0) + 1);
      ctyTotal += 1;
    }

    const state = (ed.state ?? "").trim();
    if (state) {
      stMap.set(state, (stMap.get(state) ?? 0) + 1);
      stTotal += 1;
    }
  }

  const toRows = (map: Map<string, number>, total: number, labelOf: (k: string) => string): AudienceRow[] =>
    [...map.entries()]
      .map(([id, count]) => ({ id, label: labelOf(id), count, pct: total > 0 ? count / total : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

  return {
    devices: toRows(devMap, devTotal, (k) => k),
    countries: toRows(ctyMap, ctyTotal, countryLabel),
    states: toRows(stMap, stTotal, (k) => k),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sale type breakdown — Upsell / Downsell / OrderBump (transactions.sale_type)
// ─────────────────────────────────────────────────────────────────────────────

export interface SaleTypeRow {
  type: "main" | "upsell" | "downsell" | "orderbump";
  label: string;
  sales: number; // nº de vendas aprovadas desse tipo
  revenue: number; // cents
  pct: number; // 0..1 sobre o total de vendas aprovadas
}

const SALE_TYPE_LABEL: Record<string, string> = {
  main: "Principal",
  upsell: "Upsell",
  downsell: "Downsell",
  orderbump: "Order Bump",
};

export async function getSaleTypeStats(filters: AnalyticsFilters = {}): Promise<SaleTypeRow[]> {
  const supabase = await createClient();

  const sourceLeadIds = filters.source ? await resolveSourceLeadIds(supabase, filters.source) : null;
  const rows = await fetchAllPaged<{ sale_type?: string; amount?: number }>(() => {
    let q = applyTxFilters(
      supabase.from("transactions").select("sale_type,amount,status,lead_id").eq("status", "approved").order("id", { ascending: true }),
      filters,
    );
    if (sourceLeadIds) q = sourceLeadIds.length > 0 ? q.in("lead_id", sourceLeadIds) : q.eq("lead_id", "00000000-0000-0000-0000-000000000000");
    return q;
  });

  const order: SaleTypeRow["type"][] = ["main", "upsell", "downsell", "orderbump"];
  const acc = new Map<string, { sales: number; revenue: number }>();
  for (const t of order) acc.set(t, { sales: 0, revenue: 0 });

  let total = 0;
  for (const r of rows) {
    const type = (r.sale_type ?? "main");
    const cur = acc.get(type) ?? acc.get("main")!;
    cur.sales += 1;
    cur.revenue += r.amount ?? 0;
    total += 1;
  }

  return order.map((type) => {
    const a = acc.get(type)!;
    return {
      type,
      label: SALE_TYPE_LABEL[type],
      sales: a.sales,
      revenue: a.revenue,
      pct: total > 0 ? a.sales / total : 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter options (for the Análises filter bar)
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterOptions {
  bots: { id: string; label: string }[];
  flows: { id: string; label: string }[];
  gateways: string[];
  sources: string[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const supabase = await createClient();
  const [botsRes, flowsRes, sourcesRes] = await Promise.all([
    supabase.from("bots").select("id,bot_username,redirect_display_name").order("created_at", { ascending: false }),
    supabase.from("flows").select("id,name").order("created_at", { ascending: false }),
    // DISTINCT de fontes no servidor (por frequência), sem cortar em 2000 leads.
    supabase.rpc("distinct_utm_sources", { p_limit: 50 }),
  ]);

  const bots = (botsRes.data ?? []).map((b) => ({
    id: b.id as string,
    label: (b.redirect_display_name as string) || (b.bot_username as string) || "Bot",
  }));
  const flows = (flowsRes.data ?? []).map((f) => ({ id: f.id as string, label: (f.name as string) || "Fluxo" }));
  const gateways = ["sigilopay", "evpay"];

  let sources: string[];
  if (sourcesRes.error) {
    // fallback (função ainda não aplicada): método antigo, limitado mas não quebra.
    const { data } = await supabase.from("leads").select("utm_source").not("utm_source", "is", null).limit(2000);
    sources = [...new Set((data ?? []).map((l) => l.utm_source as string).filter(Boolean))].slice(0, 50);
  } else {
    sources = (sourcesRes.data ?? []).map((r: { utm_source: string }) => r.utm_source).filter(Boolean);
  }

  return { bots, flows, gateways, sources };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant / greeting
// ─────────────────────────────────────────────────────────────────────────────

export async function getTenantName(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  // Nome editável vem de tenants.name; fallbacks: auth metadata → handle do email.
  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", user.id).single();
  const dbName = (tenant?.name as string | undefined)?.trim();
  if (dbName) return dbName;
  const meta = (user.user_metadata ?? {}) as { name?: string; full_name?: string };
  return meta.name || meta.full_name || (user.email ? user.email.split("@")[0] : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Bots fleet — each bot + its real stats (for the Bots tab)
// ─────────────────────────────────────────────────────────────────────────────

export interface BotFleetRow {
  id: string;
  bot_username: string | null;
  redirect_display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  has_tracking: boolean;
  has_payment: boolean;
  has_utmify: boolean; // tem Utmify configurada → link com UTM params
  slug_gate_enabled: boolean; // portão de slug ativo → link de cópia leva &s=
  slug_plain: string | null;  // slug secreto em claro (pra montar o link)
  revenue: number; // approved cents (all-time)
  sales: number;
  leads: number;
  created_at: string;
}

export async function getBotsFleet(viewTenantId?: string | null): Promise<BotFleetRow[]> {
  const supabase = await createClient();

  // viewTenantId: admin vendo 1 usuário → só os bots dele. As tx/leads abaixo
  // já são restringidas via .in("bot_id", ids), então herdam o recorte.
  let botsQuery = supabase
    .from("bots")
    .select("id,bot_username,redirect_display_name,avatar_url,is_active,facebook_pixel_id,facebook_access_token,tiktok_pixel_id,tiktok_access_token,sigilopay_public_key,evpay_api_key,payment_gateway,utmify_api_key,slug_gate_enabled,slug_plain,created_at")
    .order("created_at", { ascending: false });
  if (viewTenantId) botsQuery = botsQuery.eq("tenant_id", viewTenantId);
  const { data: bots } = await botsQuery;

  const list = bots ?? [];
  if (list.length === 0) return [];

  const ids = list.map((b) => b.id as string);

  // Pagina os resultados: o Supabase corta em 1000 linhas por query. Com >1000
  // transações/leads, uma query única deixava bots zerados (a receita real
  // aparecia no admin, que consulta 1 bot por vez). Aqui buscamos TODAS as
  // linhas em lotes de 1000 até esgotar.
  const PAGE = 1000;
  async function fetchAll<T>(table: string, cols: string, approvedOnly = false): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select(cols).in("bot_id", ids);
      if (approvedOnly) q = q.eq("status", "approved");
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      out.push(...(data as T[]));
      if (data.length < PAGE) break; // última página
    }
    return out;
  }

  const [txRows, leadRows] = await Promise.all([
    fetchAll<{ bot_id: string; amount: number }>("transactions", "bot_id,amount", true),
    fetchAll<{ bot_id: string }>("leads", "bot_id"),
  ]);

  const rev = new Map<string, { revenue: number; sales: number }>();
  for (const t of txRows) {
    const cur = rev.get(t.bot_id) ?? { revenue: 0, sales: 0 };
    cur.revenue += t.amount ?? 0;
    cur.sales += 1;
    rev.set(t.bot_id, cur);
  }
  const leadCount = new Map<string, number>();
  for (const l of leadRows) {
    leadCount.set(l.bot_id, (leadCount.get(l.bot_id) ?? 0) + 1);
  }

  return list.map((b) => {
    const r = rev.get(b.id as string) ?? { revenue: 0, sales: 0 };
    const hasPayment = !!(b.sigilopay_public_key || b.evpay_api_key);
    // Tracking = pixel + token de QUALQUER plataforma. Antes olhava só o pixel
    // do Facebook, então bot só-TikTok (ou FB com pixel mas sem token, que não
    // envia nada) aparecia com o selo errado na frota.
    const hasTracking = !!((b.facebook_pixel_id && b.facebook_access_token) || (b.tiktok_pixel_id && b.tiktok_access_token));
    return {
      id: b.id as string,
      bot_username: (b.bot_username as string) ?? null,
      redirect_display_name: (b.redirect_display_name as string) ?? null,
      avatar_url: (b.avatar_url as string) ?? null,
      is_active: !!b.is_active,
      has_tracking: hasTracking,
      has_payment: hasPayment,
      has_utmify: !!b.utmify_api_key,
      slug_gate_enabled: !!b.slug_gate_enabled,
      slug_plain: (b.slug_plain as string) ?? null,
      revenue: r.revenue,
      sales: r.sales,
      leads: leadCount.get(b.id as string) ?? 0,
      created_at: b.created_at as string,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard "carrega tudo 1x" — série PRÉ-AGREGADA POR DIA (horário de Brasília)
// pra o cliente filtrar por período instantaneamente, sem novo round-trip.
// Payload pequeno (~1 linha por dia), não as 10k+ transações cruas.
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyBucket {
  date: string;          // YYYY-MM-DD (BRT)
  revenue: number;       // cents aprovados
  grossRevenue: number;  // cents não recusados/estornados
  sales: number;         // aprovadas
  totalTx: number;       // qualquer status
  visits: number;        // page_view
  starts: number;        // bot_start
  checkouts: number;     // checkout
  purchases: number;     // purchase
  viewOffers: number;    // view_offer (ofertas vistas)
  buyerIds: string[];    // lead_ids das vendas aprovadas do dia (p/ distintos no período)
}

/** Receita/vendas de UMA hora de UM dia (BRT). Pra o gráfico no modo Hoje/Ontem. */
export interface HourBucket {
  date: string;   // YYYY-MM-DD (BRT)
  hour: number;   // 0..23 (BRT)
  revenue: number;
  sales: number;
}

export interface DashboardDaily {
  days: DailyBucket[];
  hours: HourBucket[]; // só horas com venda aprovada (payload pequeno)
}

export async function getDashboardDaily(viewTenantId?: string | null): Promise<DashboardDaily> {
  const supabase = await createClient();

  // viewTenantId: filtra por 1 usuário (modo admin "minha"/"por usuário"). Quando
  // null/undefined, admin vê tudo (RLS dá bypass); usuário comum é restrito por RLS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => (viewTenantId ? q.eq("tenant_id", viewTenantId) : q);

  // tudo paginado. Sem filtro de data → histórico todo.
  const [txRows, evRows] = await Promise.all([
    fetchAllPaged<{ amount: number; status: string; lead_id: string | null; created_at: string }>(
      () => scoped(supabase.from("transactions").select("amount,status,lead_id,created_at").order("id", { ascending: true })),
    ),
    fetchAllPaged<{ event_type: string; created_at: string }>(
      () => scoped(supabase.from("tracking_events").select("event_type,created_at").order("id", { ascending: true })),
    ),
  ]);

  const dayMap = new Map<string, DailyBucket>();
  const ensure = (key: string): DailyBucket => {
    let d = dayMap.get(key);
    if (!d) {
      d = { date: key, revenue: 0, grossRevenue: 0, sales: 0, totalTx: 0, visits: 0, starts: 0, checkouts: 0, purchases: 0, viewOffers: 0, buyerIds: [] };
      dayMap.set(key, d);
    }
    return d;
  };

  // hora-do-dia em BRT, só p/ vendas aprovadas (gráfico no modo Hoje/Ontem).
  const hourMap = new Map<string, HourBucket>();
  const brHour = (iso: string): number => new Date(new Date(iso).getTime() - BR_OFFSET_MIN * 60_000).getUTCHours();

  for (const t of txRows) {
    const key = brDateKey(t.created_at);
    const d = ensure(key);
    d.totalTx += 1;
    if (t.status !== "refused" && t.status !== "refunded") d.grossRevenue += t.amount ?? 0;
    if (t.status === "approved") {
      d.revenue += t.amount ?? 0;
      d.sales += 1;
      if (t.lead_id) d.buyerIds.push(t.lead_id);
      // bucket por hora
      const h = brHour(t.created_at);
      const hk = `${key}-${h}`;
      let hb = hourMap.get(hk);
      if (!hb) { hb = { date: key, hour: h, revenue: 0, sales: 0 }; hourMap.set(hk, hb); }
      hb.revenue += t.amount ?? 0;
      hb.sales += 1;
    }
  }

  for (const e of evRows) {
    const d = ensure(brDateKey(e.created_at));
    if (e.event_type === "page_view") d.visits += 1;
    else if (e.event_type === "bot_start") d.starts += 1;
    else if (e.event_type === "checkout") d.checkouts += 1;
    else if (e.event_type === "purchase") d.purchases += 1;
    else if (e.event_type === "view_offer") d.viewOffers += 1;
  }

  const days = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const hours = [...hourMap.values()];
  return { days, hours };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top 5 Players = ranking PÚBLICO dos usuários do LionBot que mais faturam.
// É um placar global (todos os tenants), então usa service-role (bypass RLS) e
// retorna SÓ nome + total faturado (agregado, sem expor dados sensíveis).
// ─────────────────────────────────────────────────────────────────────────────

export interface TopSeller {
  id: string;
  label: string;   // nome do usuário (tenant)
  revenue: number; // cents aprovados (all-time)
  sales: number;
}

export async function getTopSellers(limit = 5): Promise<TopSeller[]> {
  // service-role: precisa enxergar TODOS os tenants pro ranking global.
  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // soma o faturamento aprovado por tenant (paginado — são 10k+ transações).
  const rows: { amount: number; tenant_id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from("transactions")
      .select("amount,tenant_id")
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as { amount: number; tenant_id: string }[]));
    if (data.length < 1000) break;
  }

  const agg = new Map<string, { revenue: number; sales: number }>();
  for (const t of rows) {
    if (!t.tenant_id) continue;
    const cur = agg.get(t.tenant_id) ?? { revenue: 0, sales: 0 };
    cur.revenue += t.amount ?? 0;
    cur.sales += 1;
    agg.set(t.tenant_id, cur);
  }

  const top = [...agg.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, limit);
  if (top.length === 0) return [];

  // nomes dos tenants do top
  const ids = top.map(([id]) => id);
  const { data: tenants } = await svc.from("tenants").select("id,name,email").in("id", ids);
  const nameOf = new Map<string, string>();
  for (const t of tenants ?? []) {
    const name = ((t.name as string) || "").trim();
    const email = (t.email as string) || "";
    nameOf.set(t.id as string, name || (email ? email.split("@")[0] : "Vendedor"));
  }

  return top.map(([id, v]) => ({ id, label: nameOf.get(id) || "Vendedor", revenue: v.revenue, sales: v.sales }));
}
