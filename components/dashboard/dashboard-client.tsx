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
import type { DashboardDaily, ActivityItem, TopSeller } from "@/lib/actions/analytics-actions";

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
  topSellers,
  showTopPlayers = true,
  initialPeriod,
}: {
  daily: DashboardDaily;
  greeting: string;
  name: string;
  todayLabel: string;
  activity: ActivityItem[];
  topSellers: TopSeller[];
  showTopPlayers?: boolean;
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

    // KPIs agregados DO PERÍODO (tudo segue o filtro).
    let revenue = 0, grossRevenue = 0, sales = 0, totalTx = 0;
    let visits = 0, starts = 0, checkouts = 0, purchases = 0, viewOffers = 0;
    const buyers = new Map<string, number>();
    for (const d of inRange) {
      revenue += d.revenue; grossRevenue += d.grossRevenue; sales += d.sales; totalTx += d.totalTx;
      visits += d.visits; starts += d.starts; checkouts += d.checkouts; purchases += d.purchases;
      viewOffers += d.viewOffers ?? 0;
      for (const id of d.buyerIds) buyers.set(id, (buyers.get(id) ?? 0) + 1);
    }
    const approvalRate = totalTx > 0 ? sales / totalTx : 0;
    const avgTicket = sales > 0 ? Math.round(revenue / sales) : 0;

    // Topo do funil: usa bot_start se existir; senão cai pra view_offer (oferta
    // vista) — assim a métrica reflete o dado REAL que o bot grava.
    const topFunnel = starts > 0 ? starts : viewOffers;
    const topFunnelLabel = starts > 0 ? "starts" : "ofertas vistas";
    // Conversão = vendas / topo-do-funil (checkout→pix quando há checkout).
    const convNumerator = checkouts > 0 ? checkouts : sales;
    const conversionRate = topFunnel > 0 ? convNumerator / topFunnel : 0;
    const perSale = sales > 0 ? topFunnel / sales : 0;

    // gráfico "Seu Desempenho": receita por dia, SEGUINDO O PERÍODO.
    const to = range.to ?? (inRange.length ? inRange[inRange.length - 1].date : todayKeyBR());
    const from = range.from ?? (inRange.length ? inRange[0].date : to);
    const dayByKey = new Map(inRange.map((d) => [d.date, d]));
    const totalSpan = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
    const span = Math.min(31, totalSpan); // cap p/ legibilidade em períodos enormes
    const chartDays: { date: string; revenue: number; sales: number }[] = [];
    for (let i = span - 1; i >= 0; i--) {
      const key = addDays(to, -i);
      const d = dayByKey.get(key);
      chartDays.push({ date: key, revenue: d?.revenue ?? 0, sales: d?.sales ?? 0 });
    }

    return { revenue, grossRevenue, sales, totalTx, visits, starts, checkouts, purchases, viewOffers,
      buyers: buyers.size, approvalRate, avgTicket, conversionRate, perSale, topFunnel, topFunnelLabel, chartDays };
  }, [daily, period, startDate, endDate]);

  const periodLabel: Record<string, string> = {
    today: "Receita · hoje", yesterday: "Receita · ontem", "7d": "Receita · últimos 7 dias",
    "30d": "Receita · últimos 30 dias", all: "Receita · todo o período", custom: "Receita · período personalizado",
  };

  // Top 5 Players = ranking PÚBLICO dos usuários do LionBot que mais faturam
  // (placar global, all-time — não depende do filtro de período pessoal).
  const topPlayers = topSellers.map((p, i) => ({
    id: p.id,
    label: `${medals[i] ?? `${i + 1}º`} ${p.label}`,
    value: brl(p.revenue),
    sub: `${p.sales} venda${p.sales !== 1 ? "s" : ""}`,
  }));

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
        <KpiCard label="Vendas Aprovadas" value="" numericValue={view.revenue} format="brl" hint={`${view.sales} venda${view.sales !== 1 ? "s" : ""} · ${(view.approvalRate * 100).toFixed(0)}% aprov.`} accent="magenta" icon={icons.money} progress={view.approvalRate} revealIndex={1} />
        <CardShell title="Taxa de Conversão" subtitle={view.starts > 0 ? "start → pix" : "oferta → venda"} accent="cyan" icon={icons.activity} revealIndex={2}>
          <div className="flex items-center justify-center py-1">
            <Gauge value={view.conversionRate} label={`${view.sales} de ${view.topFunnel} ${view.topFunnelLabel}`} size={140} />
          </div>
        </CardShell>
        <KpiCard label={view.starts > 0 ? "Total Starts" : "Ofertas Vistas"} value="" numericValue={view.topFunnel} format="int" hint={`${view.perSale.toFixed(0)} por venda`} accent="purple" icon={icons.bolt} revealIndex={3} />
        <KpiCard label="Ticket Médio" value="" numericValue={view.avgTicket} format="brl" hint={`${view.sales} venda${view.sales !== 1 ? "s" : ""} no período`} accent="amber" icon={icons.ticket} revealIndex={4} />
      </div>

      {/* Revenue chart + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 animate-up-2">
        <div className="lg:col-span-2">
          <RevenueChart data={view.chartDays} subtitle={periodLabel[period] ?? "Receita"} />
        </div>
        <ActivityFeed items={activity} />
      </div>

      {/* Funnel + Top 5 Players (só admin por enquanto) + Premiações */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-up-3">
        <Funnel starts={view.topFunnel} checkouts={view.checkouts > 0 ? view.checkouts : view.sales} paid={view.sales} />
        {showTopPlayers && (
          <TopList title="Top 5 Players" subtitle="quem mais fatura no LionBot" accent="amber" icon={icons.trophy} rows={topPlayers} emptyLabel="Sem vendas ainda" />
        )}
        <ComingSoonCard title="Premiações" subtitle="conquiste novas placas" icon={icons.trophy} note="Sistema de conquistas em breve." />
        {!showTopPlayers && (
          <ComingSoonCard title="Metas" subtitle="acompanhe seus objetivos" icon={icons.trophy} note="Sistema de metas em breve." />
        )}
      </div>
    </div>
  );
}
