"use server";

import { createClient } from "@/lib/supabase/server";

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
}

/** Resolve a period into an inclusive ISO start (and optional exclusive end). */
function periodRange(
  period: Period = "today",
  startDate?: string,
  endDate?: string,
): { start: string | null; end: string | null } {
  // Server "now". We avoid Date.now() concerns by using a single Date instance.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case "today":
      return { start: startOfToday.toISOString(), end: null };
    case "yesterday": {
      const y = new Date(startOfToday);
      y.setDate(y.getDate() - 1);
      return { start: y.toISOString(), end: startOfToday.toISOString() };
    }
    case "7d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 6); // last 7 calendar days incl. today
      return { start: s.toISOString(), end: null };
    }
    case "30d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 29);
      return { start: s.toISOString(), end: null };
    }
    case "custom": {
      // intervalo personalizado: [startDate 00:00, endDate+1 00:00) — inclui o dia final
      if (!startDate || !endDate) return { start: null, end: null };
      const s = new Date(`${startDate}T00:00:00`);
      const e = new Date(`${endDate}T00:00:00`);
      e.setDate(e.getDate() + 1);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return { start: null, end: null };
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
  return q;
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

  let txQ = supabase.from("transactions").select("amount,status,lead_id");
  txQ = applyFilters(txQ, filters);
  if (filters.flowId) txQ = txQ.eq("flow_id", filters.flowId);
  if (filters.gateway) txQ = txQ.eq("gateway", filters.gateway);

  const { data: txs } = await txQ;
  const rows = txs ?? [];

  const approved = rows.filter((t) => t.status === "approved");
  const revenue = approved.reduce((s, t) => s + (t.amount ?? 0), 0);
  const grossRevenue = rows.filter((t) => t.status !== "refused" && t.status !== "refunded").reduce((s, t) => s + (t.amount ?? 0), 0);
  const sales = approved.length;
  const totalTx = rows.length;
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

  let q = supabase.from("tracking_events").select("event_type");
  q = applyFilters(q, filters);
  if (filters.source) q = q.eq("utm_params->>source", filters.source);

  const { data } = await q;
  const events = data ?? [];

  const count = (type: string) => events.filter((e) => e.event_type === type).length;
  const visits = count("page_view");
  const starts = count("bot_start");
  const checkouts = count("checkout");
  const purchases = count("purchase");

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

  let evQ = supabase.from("tracking_events").select("event_type");
  evQ = applyFilters(evQ, filters);
  const { data: ev } = await evQ;
  const events = ev ?? [];
  const starts = events.filter((e) => e.event_type === "bot_start").length;
  const checkouts = events.filter((e) => e.event_type === "checkout").length;

  // paid = approved transactions in range
  let txQ = supabase.from("transactions").select("status");
  txQ = applyFilters(txQ, filters);
  const { data: tx } = await txQ;
  const paid = (tx ?? []).filter((t) => t.status === "approved").length;

  return {
    starts,
    checkouts,
    paid,
    startToCheckout: starts > 0 ? checkouts / starts : 0,
    checkoutToPaid: checkouts > 0 ? paid / checkouts : 0,
    startToPaid: starts > 0 ? paid / starts : 0,
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

  let txQ = supabase
    .from("transactions")
    .select("amount,status,bot_id,flow_id,product_id,lead_id, bots(bot_username,redirect_display_name), flows(name), products(name,ghost_name)");
  txQ = applyFilters(txQ, filters);
  const { data } = await txQ;
  const approved = (data ?? []).filter((t) => t.status === "approved");

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
    const { data: leads } = await supabase
      .from("leads")
      .select("id,utm_campaign,utm_source")
      .in("id", leadIds);
    const leadMap = new Map((leads ?? []).map((l) => [l.id, l]));
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
}

export async function getRevenue7d(): Promise<DayPoint[]> {
  const supabase = await createClient();
  const { start } = periodRange("7d");
  let q = supabase.from("transactions").select("amount,status,created_at").eq("status", "approved");
  if (start) q = q.gte("created_at", start);
  const { data } = await q;

  const buckets = new Map<string, DayPoint>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, revenue: 0, sales: 0 });
  }
  for (const t of data ?? []) {
    const key = (t.created_at as string).slice(0, 10);
    const b = buckets.get(key);
    if (b) {
      b.revenue += (t.amount as number) ?? 0;
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

export async function getSalesByWeekday(filters: AnalyticsFilters = {}): Promise<WeekdayPoint[]> {
  const supabase = await createClient();
  // pull last 14 days of approved tx and bucket into this week / last week by weekday
  const { start } = periodRange("30d");
  let q = supabase.from("transactions").select("created_at,status,bot_id").eq("status", "approved");
  if (start) q = q.gte("created_at", start);
  if (filters.botId) q = q.eq("bot_id", filters.botId);
  const { data } = await q;

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfPrevWeek = new Date(startOfWeek);
  startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);

  const points: WeekdayPoint[] = Array.from({ length: 7 }, (_, i) => ({ weekday: i, current: 0, previous: 0 }));
  for (const t of data ?? []) {
    const d = new Date(t.created_at as string);
    const wd = d.getDay();
    if (d >= startOfWeek) points[wd].current += 1;
    else if (d >= startOfPrevWeek) points[wd].previous += 1;
  }
  return points;
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

export async function getActivityFeed(limit = 12): Promise<ActivityItem[]> {
  const supabase = await createClient();

  const [leadsRes, txRes] = await Promise.all([
    supabase.from("leads").select("first_name,username,created_at").order("created_at", { ascending: false }).limit(limit),
    supabase.from("transactions").select("amount,status,created_at, products(name,ghost_name)").order("created_at", { ascending: false }).limit(limit),
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

  let q = supabase.from("tracking_events").select("event_data").eq("event_type", "page_view");
  q = applyFilters(q, filters);
  const { data } = await q;
  const rows = (data ?? []) as {
    event_data: { user_agent?: string; country?: string; state?: string } | null;
  }[];

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

  let q = supabase.from("transactions").select("sale_type,amount,status").eq("status", "approved");
  q = applyFilters(q, filters);
  if (filters.flowId) q = q.eq("flow_id", filters.flowId);
  if (filters.gateway) q = q.eq("gateway", filters.gateway);

  const { data } = await q;
  const rows = (data ?? []) as { sale_type?: string; amount?: number }[];

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
  const [botsRes, flowsRes, leadsRes] = await Promise.all([
    supabase.from("bots").select("id,bot_username,redirect_display_name").order("created_at", { ascending: false }),
    supabase.from("flows").select("id,name").order("created_at", { ascending: false }),
    supabase.from("leads").select("utm_source").not("utm_source", "is", null).limit(500),
  ]);

  const bots = (botsRes.data ?? []).map((b) => ({
    id: b.id as string,
    label: (b.redirect_display_name as string) || (b.bot_username as string) || "Bot",
  }));
  const flows = (flowsRes.data ?? []).map((f) => ({ id: f.id as string, label: (f.name as string) || "Fluxo" }));
  const gateways = ["sigilopay", "evpay"];
  const sources = [...new Set((leadsRes.data ?? []).map((l) => l.utm_source as string).filter(Boolean))].slice(0, 30);

  return { bots, flows, gateways, sources };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant / greeting
// ─────────────────────────────────────────────────────────────────────────────

export async function getTenantName(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  // tenant name may live on auth metadata or a tenants row; fall back to email handle.
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
  revenue: number; // approved cents (all-time)
  sales: number;
  leads: number;
  created_at: string;
}

export async function getBotsFleet(): Promise<BotFleetRow[]> {
  const supabase = await createClient();

  const { data: bots } = await supabase
    .from("bots")
    .select("id,bot_username,redirect_display_name,avatar_url,is_active,facebook_pixel_id,sigilopay_public_key,evpay_api_key,payment_gateway,created_at")
    .order("created_at", { ascending: false });

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
    return {
      id: b.id as string,
      bot_username: (b.bot_username as string) ?? null,
      redirect_display_name: (b.redirect_display_name as string) ?? null,
      avatar_url: (b.avatar_url as string) ?? null,
      is_active: !!b.is_active,
      has_tracking: !!b.facebook_pixel_id,
      has_payment: hasPayment,
      revenue: r.revenue,
      sales: r.sales,
      leads: leadCount.get(b.id as string) ?? 0,
      created_at: b.created_at as string,
    };
  });
}
