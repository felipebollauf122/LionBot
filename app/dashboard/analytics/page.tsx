import {
  getRevenueStats,
  getTrackingStats,
  getFunnelStats,
  getTopBreakdowns,
  getSalesByWeekday,
  getFilterOptions,
  getAudienceBreakdown,
  getSaleTypeStats,
  type AnalyticsFilters,
  type Period,
} from "@/lib/actions/analytics-actions";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { TopList } from "@/components/dashboard/analytics/top-list";
import { Funnel } from "@/components/dashboard/analytics/funnel";
import { WeekdayChart } from "@/components/dashboard/analytics/weekday-chart";
import { FilterBar } from "@/components/dashboard/analytics/filter-bar";
import { AnimatedNumber } from "@/components/dashboard/analytics/animated-number";
import { AdminViewSwitcher } from "@/components/dashboard/admin-view-switcher";
import { resolveViewScope, getViewableUsers } from "@/lib/actions/admin-actions";
import { icons } from "@/components/dashboard/analytics/icons";

export const dynamic = "force-dynamic";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type SP = { [key: string]: string | string[] | undefined };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const requestedView = typeof sp.view === "string" ? sp.view : undefined;
  // Visão de admin (Minha/Todos/Por usuário) — restringe todas as queries.
  const scope = await resolveViewScope(requestedView);

  const filters: AnalyticsFilters = {
    period: (typeof sp.period === "string" ? sp.period : "7d") as Period,
    startDate: typeof sp.startDate === "string" ? sp.startDate : undefined,
    endDate: typeof sp.endDate === "string" ? sp.endDate : undefined,
    botId: typeof sp.botId === "string" ? sp.botId : undefined,
    flowId: typeof sp.flowId === "string" ? sp.flowId : undefined,
    gateway: typeof sp.gateway === "string" ? sp.gateway : undefined,
    source: typeof sp.source === "string" ? sp.source : undefined,
    viewTenantId: scope.tenantId,
  };

  const revenue = await getRevenueStats(filters);
  const [tracking, funnel, tops, weekday, options, audience, saleTypes, viewUsers] = await Promise.all([
    getTrackingStats(filters, revenue.sales),
    getFunnelStats(filters),
    getTopBreakdowns(filters),
    getSalesByWeekday(filters),
    getFilterOptions(),
    getAudienceBreakdown(filters),
    getSaleTypeStats(filters),
    scope.isAdmin ? getViewableUsers() : Promise.resolve([]),
  ]);

  const topRows = (rows: { id: string; label: string; revenue: number; sales: number }[]) =>
    rows.map((r) => ({ id: r.id, label: r.label, value: brl(r.revenue), sub: `${r.sales} venda${r.sales !== 1 ? "s" : ""}` }));

  // device/country/state: valor = % do total, sub = nº de visitas
  const audienceRows = (rows: { id: string; label: string; count: number; pct: number }[]) =>
    rows.map((r) => ({ id: r.id, label: r.label, value: `${(r.pct * 100).toFixed(0)}%`, sub: `${r.count} visita${r.count !== 1 ? "s" : ""}` }));

  // tipos de venda: valor = % das vendas, sub = nº de vendas + receita
  const saleTypeRows = saleTypes
    .filter((s) => s.sales > 0)
    .map((s) => ({ id: s.type, label: s.label, value: `${(s.pct * 100).toFixed(0)}%`, sub: `${s.sales} · ${brl(s.revenue)}` }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
      {/* Header (relative z-30: o dropdown do AdminViewSwitcher precisa ficar
          acima dos cards, que têm animações com transform → stacking context) */}
      <div className="relative z-30 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 animate-up">
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight page-title">
            Aná<span className="gradient-text">lises</span>
          </h1>
          <p className="text-(--text-secondary) text-sm mt-1 border-l-2 border-(--accent) pl-2">Métricas e relatórios</p>
        </div>
        {scope.isAdmin && (
          <AdminViewSwitcher users={viewUsers} currentView={requestedView ?? "all"} />
        )}
      </div>

      {/* Filters */}
      <div className="mb-6 animate-up-1">
        <FilterBar options={options} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Visitas" value="" numericValue={tracking.visits} format="int" hint={`${(tracking.startRate * 100).toFixed(1)}% viraram starts`} accent="cyan" icon={icons.eye} revealIndex={1} />
        <KpiCard label="Starts" value="" numericValue={tracking.starts} format="int" hint={`${tracking.startsPerSale.toFixed(0)} starts por venda`} accent="purple" icon={icons.bolt} revealIndex={2} />
        <KpiCard label="Receita Gerada" value="" numericValue={revenue.grossRevenue} format="brl" hint={`ticket médio ${brl(revenue.avgTicket)}`} accent="magenta" icon={icons.money} revealIndex={3} />
        <KpiCard label="Receita Confirmada" value="" numericValue={revenue.revenue} format="brl" hint={`${(revenue.approvalRate * 100).toFixed(1).replace(".", ",")}% de aprovação`} accent="cyan" icon={icons.check} progress={revenue.approvalRate} revealIndex={4} />
      </div>

      {/* Weekday + funnel row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 animate-up-3">
        <div className="lg:col-span-2">
          <WeekdayChart data={weekday.points} todayIdx={weekday.todayIdx} />
        </div>
        <Funnel starts={funnel.starts} checkouts={funnel.checkouts} paid={funnel.paid} />
      </div>

      {/* Top breakdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4 animate-up-3">
        <TopList title="Top 5 Bots" subtitle="mais vendidos" accent="magenta" icon={icons.bot} rows={topRows(tops.bots)} />
        <TopList title="Top 5 Fluxos" subtitle="mais vendidos" accent="cyan" icon={icons.flow} rows={topRows(tops.flows)} />
        <TopList title="Top 5 Planos" subtitle="mais vendidos" accent="amber" icon={icons.trophy} rows={topRows(tops.products)} />
        <TopList title="Top Campanhas" subtitle="tráfego pago" accent="purple" icon={icons.megaphone} rows={topRows(tops.campaigns)} emptyLabel="Sem campanhas rastreadas" />
      </div>

      {/* Sources + customer metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4 animate-up-4">
        <TopList title="Fontes de Tráfego" subtitle="de onde vêm as vendas" accent="cyan" icon={icons.globe} rows={topRows(tops.sources)} emptyLabel="Sem fontes rastreadas" />
        <CardShell title="LTV Médio" subtitle="lifetime value" accent="magenta" icon={icons.money} revealIndex={5}>
          <p className="stat-value text-3xl text-(--accent) mt-2 num-pop" style={{ textShadow: "0 0 18px var(--accent-glow)" }}>
            <AnimatedNumber value={revenue.ltv} format="brl" />
          </p>
          <p className="text-[11px] text-(--text-muted) mt-1">gasto médio por cliente</p>
        </CardShell>
        <CardShell title="Vendas por Usuário" subtitle="média" accent="purple" icon={icons.users} revealIndex={6}>
          <p className="stat-value text-3xl text-(--purple) mt-2 num-pop" style={{ textShadow: "0 0 18px var(--purple-glow)" }}>
            <AnimatedNumber value={revenue.salesPerBuyer} format="mult" />
          </p>
          <p className="text-[11px] text-(--text-muted) mt-1">compras por cliente</p>
        </CardShell>
        <CardShell title="Taxa Recorrência" subtitle="compradores recorrentes" accent="cyan" icon={icons.repeat} revealIndex={7}>
          <p className="stat-value text-3xl text-(--cyan) mt-2 num-pop" style={{ textShadow: "0 0 18px var(--cyan-glow)" }}>
            <AnimatedNumber value={revenue.recurrenceRate * 100} format="pct1" />
          </p>
          <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${revenue.recurrenceRate * 100}%`, background: "linear-gradient(90deg, var(--cyan), var(--accent))", transition: "width 1s cubic-bezier(0.16,1,0.3,1)" }} />
          </div>
        </CardShell>
      </div>

      {/* Audiência + tipos de venda (dados reais) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-up-5">
        <TopList title="Países" subtitle="de onde vêm as visitas" accent="cyan" icon={icons.globe} rows={audienceRows(audience.countries)} emptyLabel="Sem dados de país ainda" />
        <TopList title="Estados" subtitle="por região (Brasil)" accent="amber" icon={icons.pin} rows={audienceRows(audience.states)} emptyLabel="Sem dados de estado ainda" />
        <TopList title="Dispositivos" subtitle="distribuição por tipo" accent="purple" icon={icons.device} rows={audienceRows(audience.devices)} emptyLabel="Sem dados de dispositivo ainda" />
        <TopList title="Upsell / Downsell / OrderBump" subtitle="tipos de venda" accent="magenta" icon={icons.arrowUp} rows={saleTypeRows} emptyLabel="Marque o tipo nos nós de pagamento" />
      </div>
    </div>
  );
}
