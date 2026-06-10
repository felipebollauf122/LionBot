import {
  getRevenueStats,
  getTrackingStats,
  getFunnelStats,
  getTopBreakdowns,
  getSalesByWeekday,
  getFilterOptions,
  type AnalyticsFilters,
  type Period,
} from "@/lib/actions/analytics-actions";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { TopList } from "@/components/dashboard/analytics/top-list";
import { Funnel } from "@/components/dashboard/analytics/funnel";
import { WeekdayChart } from "@/components/dashboard/analytics/weekday-chart";
import { ComingSoonCard } from "@/components/dashboard/analytics/coming-soon-card";
import { FilterBar } from "@/components/dashboard/analytics/filter-bar";
import { icons } from "@/components/dashboard/analytics/icons";

export const dynamic = "force-dynamic";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type SP = { [key: string]: string | string[] | undefined };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters: AnalyticsFilters = {
    period: (typeof sp.period === "string" ? sp.period : "today") as Period,
    botId: typeof sp.botId === "string" ? sp.botId : undefined,
    flowId: typeof sp.flowId === "string" ? sp.flowId : undefined,
    gateway: typeof sp.gateway === "string" ? sp.gateway : undefined,
    source: typeof sp.source === "string" ? sp.source : undefined,
  };

  const revenue = await getRevenueStats(filters);
  const [tracking, funnel, tops, weekday, options] = await Promise.all([
    getTrackingStats(filters, revenue.sales),
    getFunnelStats(filters),
    getTopBreakdowns(filters),
    getSalesByWeekday(filters),
    getFilterOptions(),
  ]);

  const topRows = (rows: { id: string; label: string; revenue: number; sales: number }[]) =>
    rows.map((r) => ({ id: r.id, label: r.label, value: brl(r.revenue), sub: `${r.sales} venda${r.sales !== 1 ? "s" : ""}` }));

  return (
    <div className="p-6 lg:p-8 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 animate-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight page-title">
            Aná<span className="gradient-text">lises</span>
          </h1>
          <p className="text-(--text-secondary) text-sm mt-1 border-l-2 border-(--accent) pl-2">Métricas e relatórios</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 animate-up-1">
        <FilterBar options={options} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4 animate-up-2">
        <KpiCard label="Visitas" value={tracking.visits.toLocaleString("pt-BR")} hint={`${(tracking.startRate * 100).toFixed(1)}% viraram starts`} accent="cyan" icon={icons.eye} />
        <KpiCard label="Starts" value={tracking.starts.toLocaleString("pt-BR")} hint={`${tracking.startsPerSale.toFixed(0)} starts por venda`} accent="purple" icon={icons.bolt} />
        <KpiCard label="Receita Gerada" value={brl(revenue.grossRevenue)} hint={`ticket médio ${brl(revenue.avgTicket)}`} accent="magenta" icon={icons.money} />
        <KpiCard label="Receita Confirmada" value={brl(revenue.revenue)} hint={`${(revenue.approvalRate * 100).toFixed(0)}% de aprovação`} accent="cyan" delta={`${(revenue.approvalRate * 100).toFixed(0)}%`} deltaUp icon={icons.check} progress={revenue.approvalRate} />
      </div>

      {/* Weekday + funnel row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 animate-up-3">
        <div className="lg:col-span-2">
          <WeekdayChart data={weekday} />
        </div>
        <Funnel starts={funnel.starts} checkouts={funnel.checkouts} paid={funnel.paid} />
      </div>

      {/* Top breakdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4 animate-up-3">
        <TopList title="Top 5 Bots" subtitle="mais vendidos" accent="magenta" icon={icons.bot} rows={topRows(tops.bots)} />
        <TopList title="Top 5 Fluxos" subtitle="mais vendidos" accent="cyan" icon={icons.flow} rows={topRows(tops.flows)} />
        <TopList title="Top 5 Planos" subtitle="mais vendidos" accent="amber" icon={icons.trophy} rows={topRows(tops.products)} />
        <TopList title="Top Campanhas" subtitle="tráfego pago" accent="purple" icon={icons.megaphone} rows={topRows(tops.campaigns)} emptyLabel="Sem campanhas rastreadas" />
      </div>

      {/* Sources + customer metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4 animate-up-4">
        <TopList title="Fontes de Tráfego" subtitle="de onde vêm as vendas" accent="cyan" icon={icons.globe} rows={topRows(tops.sources)} emptyLabel="Sem fontes rastreadas" />
        <CardShell title="LTV Médio" subtitle="lifetime value" accent="magenta" icon={icons.money}>
          <p className="stat-value text-3xl text-(--accent) mt-2" style={{ textShadow: "0 0 18px var(--accent-glow)" }}>{brl(revenue.ltv)}</p>
          <p className="text-[11px] text-(--text-muted) mt-1">gasto médio por cliente</p>
        </CardShell>
        <CardShell title="Vendas por Usuário" subtitle="média" accent="purple" icon={icons.users}>
          <p className="stat-value text-3xl text-(--purple) mt-2" style={{ textShadow: "0 0 18px var(--purple-glow)" }}>{revenue.salesPerBuyer.toFixed(1)}×</p>
          <p className="text-[11px] text-(--text-muted) mt-1">compras por cliente</p>
        </CardShell>
        <CardShell title="Taxa Recorrência" subtitle="compradores recorrentes" accent="cyan" icon={icons.repeat}>
          <p className="stat-value text-3xl text-(--cyan) mt-2" style={{ textShadow: "0 0 18px var(--cyan-glow)" }}>{(revenue.recurrenceRate * 100).toFixed(1)}%</p>
          <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${revenue.recurrenceRate * 100}%`, background: "linear-gradient(90deg, var(--cyan), var(--accent))" }} />
          </div>
        </CardShell>
      </div>

      {/* Placeholders (🔴 no data source) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-up-5">
        <ComingSoonCard title="Geolocalização" subtitle="mapa de leads por estado" icon={icons.pin} note="Precisa de captura de localização — em breve." />
        <ComingSoonCard title="Dispositivos" subtitle="distribuição por tipo" icon={icons.device} note="Captura de dispositivo em desenvolvimento." />
        <ComingSoonCard title="Taxa Upsell / Downsell / OrderBump" subtitle="tipos de venda" icon={icons.arrowUp} note="Classificação de transações em breve." />
      </div>
    </div>
  );
}
