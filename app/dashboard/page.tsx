import { createClient } from "@/lib/supabase/server";
import { BotCard } from "@/components/dashboard/bot-card";
import { LionMark } from "@/components/brand/lion-mark";
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
import type { Bot } from "@/lib/types/database";

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
  const supabase = await createClient();

  const [botsRes, name, revenue] = await Promise.all([
    supabase.from("bots").select("*").order("created_at", { ascending: false }),
    getTenantName(),
    getRevenueStats({ period: "today" }),
  ]);

  const [tracking, series, funnel, activity] = await Promise.all([
    getTrackingStats({ period: "today" }, revenue.sales),
    getRevenue7d(),
    getFunnelStats({ period: "today" }),
    getActivityFeed(12),
  ]);

  const { data: bots, error } = botsRes;
  const botList = (bots ?? []) as Bot[];
  const activeBots = botList.filter((b) => b.is_active).length;

  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
  const conversionRate = tracking.starts > 0 ? tracking.checkouts / tracking.starts : 0;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px]">
      {/* Greeting header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 animate-up">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight page-title">
            {greeting()}, <span className="gradient-text">{name || "vendedor"}</span>
          </h1>
          <p className="text-[11px] text-(--text-muted) tracking-[0.2em] uppercase mt-1 stat-value">{today}</p>
        </div>
        <a href="/dashboard/bots/new" className="btn-primary self-start sm:self-auto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo Bot
        </a>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl border border-(--red)/15 text-(--red) text-sm" style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)" }}>
          Erro ao carregar bots: {error.message}
        </div>
      )}

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8 animate-up-3">
        <Funnel starts={funnel.starts} checkouts={funnel.checkouts} paid={funnel.paid} />
        <ComingSoonCard title="Premiações" subtitle="conquiste novas placas" icon={icons.trophy} note="Sistema de conquistas em breve." />
        <ComingSoonCard title="Top 5 Players" subtitle="corrida de faturamento" icon={icons.trophy} note="Ranking competitivo em breve." />
      </div>

      {/* Bots section */}
      <div className="flex items-center justify-between mb-4 animate-up-4">
        <h2 className="text-lg font-bold text-foreground tracking-tight page-title">
          Meus Bots {botList.length > 0 && <span className="text-(--text-ghost) stat-value text-sm">({activeBots}/{botList.length} ativos)</span>}
        </h2>
      </div>

      {botList.length === 0 && !error ? (
        <div className="text-center py-20 animate-up">
          <div className="w-20 h-20 mx-auto mb-5 flex items-center justify-center"><LionMark size={72} /></div>
          <h2 className="text-foreground text-lg font-bold mb-2 tracking-tight page-title">Nenhum bot ainda</h2>
          <p className="text-(--text-muted) text-sm mb-6 max-w-xs mx-auto">Crie seu primeiro bot para comecar a vender no Telegram</p>
          <a href="/dashboard/bots/new" className="btn-primary">Criar primeiro bot</a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-up-4">
          {botList.map((bot) => (
            <BotCard key={bot.id} bot={bot} />
          ))}
        </div>
      )}
    </div>
  );
}
