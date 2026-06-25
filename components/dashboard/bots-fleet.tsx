"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LionMark } from "@/components/brand/lion-mark";
import { CommandBar, CommandSearch, KpiPill, FilterChip } from "@/components/dashboard/console/command-bar";
import { AnimatedNumber } from "@/components/dashboard/analytics/animated-number";
import { AdminViewSwitcher } from "@/components/dashboard/admin-view-switcher";
import { buildTrackingLink } from "@/lib/tracking-link";
import type { BotFleetRow } from "@/lib/actions/analytics-actions";
import type { ViewableUser } from "@/lib/actions/admin-actions";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Versão compacta p/ telas estreitas: R$ 12.999,90 → "R$ 13,0k", R$ 1,2M → "R$ 1,2M". */
function brlCompact(cents: number) {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (v >= 10_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return brl(cents);
}

type Filter = "all" | "active" | "inactive";

/**
 * Fleet view — each bot is a rich horizontal "mission control" panel:
 * status crest, live metrics (revenue/sales/leads), capability bar, quick open.
 * Replaces the old square card grid with a dense, informative fleet layout.
 */
export function BotsFleet({
  bots,
  isAdmin = false,
  viewUsers = [],
  currentView = "all",
}: {
  bots: BotFleetRow[];
  isAdmin?: boolean;
  viewUsers?: ViewableUser[];
  currentView?: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bots.filter((b) => {
      if (filter === "active" && !b.is_active) return false;
      if (filter === "inactive" && b.is_active) return false;
      if (!q) return true;
      const name = (b.redirect_display_name || b.bot_username || "").toLowerCase();
      return name.includes(q);
    });
  }, [bots, search, filter]);

  const totals = useMemo(
    () => ({
      active: bots.filter((b) => b.is_active).length,
      revenue: bots.reduce((s, b) => s + b.revenue, 0),
      leads: bots.reduce((s, b) => s + b.leads, 0),
    }),
    [bots],
  );

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Bots"
        subtitle="sua frota de vendas"
        search={<CommandSearch value={search} onChange={setSearch} placeholder="Buscar bot..." />}
        filters={
          <>
            {isAdmin && <AdminViewSwitcher users={viewUsers} currentView={currentView} />}
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} count={bots.length}>Todos</FilterChip>
            <FilterChip active={filter === "active"} onClick={() => setFilter("active")} count={totals.active}>Ativos</FilterChip>
            <FilterChip active={filter === "inactive"} onClick={() => setFilter("inactive")} count={bots.length - totals.active}>Inativos</FilterChip>
          </>
        }
        kpis={
          <>
            <KpiPill label="receita" value={brl(totals.revenue)} accent="magenta" />
            <KpiPill label="leads" value={totals.leads.toLocaleString("pt-BR")} accent="cyan" />
          </>
        }
        action={
          <Link href="/dashboard/bots/new" className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Novo Bot
          </Link>
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6 max-w-[1500px] mx-auto w-full">
        {filtered.length === 0 ? (
          <div className="text-center py-24 animate-up">
            <div className="w-20 h-20 mx-auto mb-5 flex items-center justify-center"><LionMark size={72} /></div>
            <h2 className="text-foreground text-lg font-bold mb-2 tracking-tight page-title">
              {bots.length === 0 ? "Nenhum bot ainda" : "Nenhum bot encontrado"}
            </h2>
            <p className="text-(--text-muted) text-sm mb-6 max-w-xs mx-auto">
              {bots.length === 0 ? "Crie seu primeiro bot para começar a vender no Telegram" : "Tente outro filtro ou busca"}
            </p>
            {bots.length === 0 && <Link href="/dashboard/bots/new" className="btn-primary">Criar primeiro bot</Link>}
          </div>
        ) : (
          <div className="space-y-3 lg:space-y-4">
            {filtered.map((b, i) => (
              <FleetPanel key={b.id} bot={b} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FleetPanel({ bot, index }: { bot: BotFleetRow; index: number }) {
  const name = bot.redirect_display_name || bot.bot_username || "Bot";
  const href = `/dashboard/bots/${bot.id}/flows`;

  return (
    <Link
      href={href}
      className="card-interactive card group flex flex-col items-stretch lg:flex-row lg:items-center gap-4 lg:gap-6 p-4 sm:p-5 reveal min-w-0 overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
    >
      {/* Crest + identity */}
      <div className="flex items-center gap-3.5 min-w-0 lg:w-64 lg:shrink-0">
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
            {bot.avatar_url ? (
              <img src={bot.avatar_url} alt="" className="w-11 h-11 rounded-lg object-cover" />
            ) : (
              <LionMark size={34} glow={false} />
            )}
          </div>
          <span className={`status-dot ${bot.is_active ? "active" : "inactive"} absolute -bottom-0.5 -right-0.5 ring-2 ring-(--bg-surface)`} />
        </div>
        <div className="min-w-0">
          <h3 className="text-foreground font-semibold tracking-tight truncate group-hover:text-(--accent-hover) transition-colors">{name}</h3>
          <p className="text-[11px] text-(--text-ghost) font-mono stat-value truncate">@{bot.bot_username ?? "—"}</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="flex-1 grid grid-cols-3 gap-2 sm:gap-3 min-w-0">
        <Metric label="Receita" accent="magenta">
          {/* mobile: compacto (cabe valores grandes); ≥sm: valor cheio */}
          <span className="sm:hidden">{brlCompact(bot.revenue)}</span>
          <span className="hidden sm:inline"><AnimatedNumber value={bot.revenue} format="brl" /></span>
        </Metric>
        <Metric label="Vendas" accent="cyan">
          <AnimatedNumber value={bot.sales} format="int" />
        </Metric>
        <Metric label="Leads" accent="purple">
          <AnimatedNumber value={bot.leads} format="int" />
        </Metric>
      </div>

      {/* Capabilities + status + ações */}
      <div className="flex items-center justify-between lg:justify-end gap-3 min-w-0 lg:w-72 lg:shrink-0">
        <div className="flex flex-col gap-2">
          <Capability on={bot.has_tracking} label="Tracking" />
          <Capability on={bot.has_payment} label="Pagamento" />
        </div>
        <span className={`badge ${bot.is_active ? "badge-active" : "badge-inactive"} shrink-0`}>
          {bot.is_active ? "Ativo" : "Inativo"}
        </span>
        <CopyLinkButton botId={bot.id} hasUtmify={bot.has_utmify} />
        <svg className="hidden lg:block w-4 h-4 text-(--text-muted) group-hover:text-(--accent) group-hover:translate-x-0.5 transition-all shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </div>
    </Link>
  );
}

/** Botão "Copiar link" do bot. Para o clique no card (que navega pros flows). */
function CopyLinkButton({ botId, hasUtmify }: { botId: string; hasUtmify: boolean }) {
  const [copied, setCopied] = useState(false);

  function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    navigator.clipboard.writeText(buildTrackingLink(botId, hasUtmify, origin));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={hasUtmify ? "Copiar link com UTMs (Utmify)" : "Copiar link do bot"}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
        copied
          ? "border-(--cyan)/40 text-(--cyan) bg-(--cyan)/10"
          : "border-(--border-subtle) text-(--text-secondary) hover:text-foreground hover:border-(--accent)/40 hover:bg-white/5"
      }`}
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Copiado
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          Link
        </>
      )}
    </button>
  );
}

function Metric({ label, accent, children }: { label: string; accent: "magenta" | "cyan" | "purple"; children: React.ReactNode }) {
  const color = { magenta: "var(--accent)", cyan: "var(--cyan)", purple: "var(--purple)" }[accent];
  return (
    <div className="min-w-0 rounded-lg bg-white/[0.02] border border-(--border-subtle) px-2 py-2 sm:px-3">
      <p className="stat-value text-[13px] sm:text-base num-pop leading-tight" style={{ color }}>{children}</p>
      <p className="text-[9px] uppercase tracking-wider text-(--text-ghost) mt-0.5 truncate">{label}</p>
    </div>
  );
}

function Capability({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`status-dot ${on ? "active" : "inactive"}`} style={{ width: 6, height: 6 }} />
      <span className="text-[10px] text-(--text-muted)">{label}</span>
    </div>
  );
}
