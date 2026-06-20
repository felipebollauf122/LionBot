"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PeriodFilter, type PeriodValue } from "@/components/dashboard/period-filter";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { RevenueChart } from "@/components/dashboard/analytics/revenue-chart";
import { ActivityFeed } from "@/components/dashboard/analytics/activity-feed";
import { Funnel } from "@/components/dashboard/analytics/funnel";
import { Gauge } from "@/components/dashboard/analytics/gauge";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { TopList } from "@/components/dashboard/analytics/top-list";
import { ComingSoonCard } from "@/components/dashboard/analytics/coming-soon-card";
import { icons } from "@/components/dashboard/analytics/icons";
import { periodDayRange, dayInRange, todayKeyBR, type PeriodKey } from "@/lib/period";
import type { DashboardDaily } from "@/lib/actions/analytics-actions";
import type { ActivityItem } from "@/lib/actions/analytics-actions";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const medals = ["🥇", "🥈", "🥉"];

/**
 * Renderiza a dashboard 100% no cliente a partir da série diária pré-carregada.
 * Trocar de período é INSTANTÂNEO: só re-agrega os dias do período em memória,
 * sem novo round-trip ao servidor. (ActivityFeed é "recente", vem fixo do server.)
 */
export function DashboardClient({
  daily,
  greeting,
  name,
  todayLabel,
  activity,
  initialPeriod,
}: {
  daily: DashboardDaily;
  greeting: string;
  name: string;
  todayLabel: string;
  activity: ActivityItem[];
  initialPeriod?: string;
}) {
  // estado local → trocar período é 100% client (instantâneo, sem round-trip).
  const [sel, setSel] = useState<PeriodValue>({ period: initialPeriod ?? "7d" });
  const period = sel.period as PeriodKey;
  const startDate = sel.startDate;
  const endDate = sel.endDate;

  const view = useMemo(() => {
    const range = periodDayRange(period, { startDate, endDate });
    const inRange = daily.days.filter((d) => dayInRange(d.date, range));

    // KPIs agregados do período
    let revenue = 0, grossRevenue = 0, sales = 0, totalTx = 0;
    let visits = 0, starts = 0, checkouts = 0, purchases = 0;
    const buyers = new Map<string, number>();
    for (const d of inRange) {
      revenue += d.revenue; grossRevenue += d.grossRevenue; sales += d.sales; totalTx += d.totalTx;
      visits += d.visits; starts += d.starts; checkouts += d.checkouts; purchases += d.purchases;
      for (const id of d.buyerIds) buyers.set(id, (buyers.get(id) ?? 0) + 1);
    }
    const approvalRate = totalTx > 0 ? sales / totalTx : 0;
    const avgTicket = sales > 0 ? Math.round(revenue / sales) : 0;
    const conversionRate = starts > 0 ? checkouts / starts : 0;
    const startsPerSale = sales > 0 ? starts / sales : 0;

    // gráfico: receita por dia DENTRO do período (cap nos últimos 14 dias do range
    // pra não ficar gigante; se o período for curto, mostra só ele).
    const to = range.to ?? todayKeyBR();
    const from = range.from ?? (inRange[0]?.date ?? to);
    const chartDays: { date: string; revenue: number; sales: number }[] = [];
    // limita a 14 buckets pra leitura
    const dayByKey = new Map(inRange.map((d) => [d.date, d]));
    const span = Math.min(14, Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1));
    for (let i = span - 1; i >= 0; i--) {
      const key = addDays(to, -i);
      const d = dayByKey.get(key);
      chartDays.push({ date: key, revenue: d?.revenue ?? 0, sales: d?.sales ?? 0 });
    }

    // Top 5 bots por receita no período
    const topPlayers = daily.bots
      .map((b) => {
        let rev = 0, s = 0;
        for (const [date, cell] of Object.entries(b.byDate)) {
          if (dayInRange(date, range)) { rev += cell.revenue; s += cell.sales; }
        }
        return { id: b.id, label: b.label, revenue: rev, sales: s };
      })
      .filter((b) => b.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((b, i) => ({ id: b.id, label: `${medals[i] ?? `${i + 1}º`} ${b.label}`, value: brl(b.revenue), sub: `${b.sales} venda${b.sales !== 1 ? "s" : ""}` }));

    return { revenue, grossRevenue, sales, totalTx, visits, starts, checkouts, purchases,
      buyers: buyers.size, approvalRate, avgTicket, conversionRate, startsPerSale, chartDays, topPlayers };
  }, [daily, period, startDate, endDate]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
      {/* Greeting header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 animate-up">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight page-title">
            {greeting}, <span className="gradient-text">{name || "vendedor"}</span>
          </h1>
          <p className="text-[11px] text-(--text-muted) tracking-[0.2em] uppercase mt-1 stat-value">{todayLabel}</p>
        </div>
        <Link href="/dashboard/bots" className="btn-ghost self-start sm:self-auto">
          Ver meus bots
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {/* Filtro de período (troca instantânea — agrega no cliente) */}
      <div className="mb-4 animate-up flex justify-end">
        <PeriodFilter value={sel} onChange={setSel} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Vendas Aprovadas" value="" numericValue={view.revenue} format="brl" hint={`${(view.approvalRate * 100).toFixed(0)}% aprov.`} accent="magenta" icon={icons.money} progress={view.approvalRate} revealIndex={1} />
        <CardShell title="Taxa de Conversão" subtitle="start → pix" accent="cyan" icon={icons.activity} revealIndex={2}>
          <div className="flex items-center justify-center py-1">
            <Gauge value={view.conversionRate} label={`${view.checkouts} de ${view.starts} starts`} size={140} />
          </div>
        </CardShell>
        <KpiCard label="Total Starts" value="" numericValue={view.starts} format="int" hint={`${view.startsPerSale.toFixed(0)} starts por venda`} accent="purple" icon={icons.bolt} revealIndex={3} />
        <KpiCard label="Ticket Médio" value="" numericValue={view.avgTicket} format="brl" hint={`${view.checkouts} PIX gerados · ${view.sales} pagos`} accent="amber" icon={icons.ticket} revealIndex={4} />
      </div>

      {/* Revenue chart + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 animate-up-2">
        <div className="lg:col-span-2">
          <RevenueChart data={view.chartDays} />
        </div>
        <ActivityFeed items={activity} />
      </div>

      {/* Funnel + Top 5 Players (ranking real) + Premiações (placeholder) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-up-3">
        <Funnel starts={view.starts} checkouts={view.checkouts} paid={view.sales} />
        <TopList title="Top 5 Players" subtitle="corrida de faturamento" accent="amber" icon={icons.trophy} rows={view.topPlayers} emptyLabel="Sem vendas no período" />
        <ComingSoonCard title="Premiações" subtitle="conquiste novas placas" icon={icons.trophy} note="Sistema de conquistas em breve." />
      </div>
    </div>
  );
}
