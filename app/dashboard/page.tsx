import { createClient } from "@/lib/supabase/server";
import { BotCard } from "@/components/dashboard/bot-card";
import { OverviewStats } from "@/components/dashboard/overview-stats";
import type { Bot } from "@/lib/types/database";

export default async function DashboardPage() {
  const supabase = await createClient();
  // 3 queries independentes em paralelo (#36) — antes eram seriais.
  const [botsRes, leadsRes, txRes] = await Promise.all([
    supabase.from("bots").select("*").order("created_at", { ascending: false }),
    supabase.from("leads").select("*", { count: "exact", head: true }),
    supabase.from("transactions").select("amount").eq("status", "approved"),
  ]);

  const { data: bots, error } = botsRes;
  const botList = (bots ?? []) as Bot[];
  const activeBots = botList.filter((b) => b.is_active).length;

  const totalLeads = leadsRes.count;
  const approvedTx = txRes.data;
  const totalRevenue = (approvedTx ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const totalSales = (approvedTx ?? []).length;

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-up">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight page-title">
            Meus Bots
          </h1>
          <p className="text-(--text-secondary) text-sm mt-1">
            Gerencie seus bots de vendas do Telegram
          </p>
        </div>
        <a href="/dashboard/bots/new" className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo Bot
        </a>
      </div>

      {/* Stats */}
      {botList.length > 0 && (
        <OverviewStats
          totalBots={botList.length}
          activeBots={activeBots}
          totalLeads={totalLeads ?? 0}
          totalRevenue={totalRevenue}
          totalSales={totalSales}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl border border-(--red)/15 text-(--red) text-sm" style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(239,68,68,0.04) 100%)" }}>
          Erro ao carregar bots: {error.message}
        </div>
      )}

      {/* Bot List */}
      {botList.length === 0 && !error ? (
        <div className="text-center py-24 animate-up">
          <img src="/logo.png" alt="EagleBot" className="w-20 h-20 object-contain mx-auto mb-5" style={{ filter: "drop-shadow(0 0 16px rgba(34,211,238,0.2))" }} />
          <h2 className="text-foreground text-lg font-bold mb-2 tracking-tight page-title">
            Nenhum bot ainda
          </h2>
          <p className="text-(--text-muted) text-sm mb-6 max-w-xs mx-auto">
            Crie seu primeiro bot para comecar a vender no Telegram
          </p>
          <a href="/dashboard/bots/new" className="btn-primary">
            Criar primeiro bot
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-up-2">
          {botList.map((bot) => (
            <BotCard key={bot.id} bot={bot} />
          ))}
        </div>
      )}
    </div>
  );
}
