import {
  getRevenueStats,
  getTrackingStats,
  getRevenue7d,
  getFunnelStats,
  getActivityFeed,
  getTenantName,
} from "@/lib/actions/analytics-actions";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { RevenueChart } from "@/components/dashboard/analytics/revenue-chart";
import { ActivityFeed } from "@/components/dashboard/analytics/activity-feed";
import { Funnel } from "@/components/dashboard/analytics/funnel";
import { Gauge } from "@/components/dashboard/analytics/gauge";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { ComingSoonCard } from "@/components/dashboard/analytics/coming-soon-card";
import { icons } from "@/components/dashboard/analytics/icons";

export const dynamic = "force-dynamic";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default async function DashboardPage() {
  const [name, revenue] = await Promise.all([
    getTenantName(),
    getRevenueStats({ period: "today" }),
  ]);

  const [tracking, series, funnel, activity] = await Promise.all([
    getTrackingStats({ period: "today" }, revenue.sales),
    getRevenue7d(),
    getFunnelStats({ period: "today" }),
    getActivityFeed(12),
  ]);

  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
  const conversionRate = tracking.starts > 0 ? tracking.checkouts / tracking.starts : 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
      {/* Greeting header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 animate-up">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight page-title">
            {greeting()}, <span className="gradient-text">{name || "vendedor"}</span>
          </h1>
          <p className="text-[11px] text-(--text-muted) tracking-[0.2em] uppercase mt-1 stat-value">{today}</p>
        </div>
        <a href="/dashboard/bots" className="btn-ghost self-start sm:self-auto">
          Ver meus bots
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </a>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Vendas Aprovadas" value="" numericValue={revenue.revenue} format="brl" hint={`${(revenue.approvalRate * 100).toFixed(0)}% aprov.`} accent="magenta" icon={icons.money} progress={revenue.approvalRate} revealIndex={1} />
        <CardShell title="Taxa de Conversão" subtitle="start → pix" accent="cyan" icon={icons.activity} revealIndex={2}>
          <div className="flex items-center justify-center py-1">
            <Gauge value={conversionRate} label={`${tracking.checkouts} de ${tracking.starts} starts`} size={140} />
          </div>
        </CardShell>
        <KpiCard label="Total Starts" value="" numericValue={tracking.starts} format="int" hint={`${tracking.startsPerSale.toFixed(0)} starts por venda`} accent="purple" icon={icons.bolt} revealIndex={3} />
        <KpiCard label="Ticket Médio" value="" numericValue={revenue.avgTicket} format="brl" hint={`${funnel.checkouts} PIX gerados · ${funnel.paid} pagos`} accent="amber" icon={icons.ticket} revealIndex={4} />
      </div>

      {/* Revenue chart + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 animate-up-2">
        <div className="lg:col-span-2">
          <RevenueChart data={series} />
        </div>
        <ActivityFeed items={activity} />
      </div>

      {/* Funnel + gamification placeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-up-3">
        <Funnel starts={funnel.starts} checkouts={funnel.checkouts} paid={funnel.paid} />
        <ComingSoonCard title="Premiações" subtitle="conquiste novas placas" icon={icons.trophy} note="Sistema de conquistas em breve." />
        <ComingSoonCard title="Top 5 Players" subtitle="corrida de faturamento" icon={icons.trophy} note="Ranking competitivo em breve." />
      </div>
    </div>
  );
}
