interface OverviewStatsProps {
  totalBots: number;
  activeBots: number;
  totalLeads: number;
  totalRevenue: number;
  totalSales: number;
}

const icons = {
  bots: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
  leads: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z",
  sales: "M22 12h-4l-3 9L9 3l-3 9H2",
  revenue: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
};

export function OverviewStats({ totalBots, activeBots, totalLeads, totalRevenue, totalSales }: OverviewStatsProps) {
  const cards = [
    { label: "Bots Ativos", value: `${activeBots}/${totalBots}`, icon: icons.bots, color: "var(--accent)", glowColor: "var(--accent-glow)" },
    { label: "Total de Leads", value: totalLeads.toLocaleString("pt-BR"), icon: icons.leads, color: "var(--cyan)", glowColor: "var(--cyan-glow)" },
    { label: "Vendas Aprovadas", value: totalSales.toLocaleString("pt-BR"), icon: icons.sales, color: "var(--purple)", glowColor: "var(--purple-glow)" },
    { label: "Receita Total", value: (totalRevenue / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), icon: icons.revenue, color: "var(--accent)", glowColor: "var(--accent-glow)" },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
      {cards.map((card, i) => (
        <div
          key={card.label}
          className={`card p-5 animate-up-${i + 1} group relative`}
        >
          {/* Top accent line */}
          <div className="absolute top-0 left-4 right-4 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: `linear-gradient(90deg, transparent, ${card.color}, transparent)` }} />

          <div className="flex items-center justify-between mb-4">
            <p className="text-(--text-muted) text-[10px] font-bold uppercase tracking-[0.08em]">{card.label}</p>
            <div
              className="section-icon w-9 h-9"
              style={{ background: `color-mix(in srgb, ${card.color} 12%, transparent)` }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={card.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={card.icon} />
              </svg>
            </div>
          </div>
          <p className="stat-value text-2xl text-foreground">{card.value}</p>

          {/* Hover glow */}
          <div className="absolute bottom-0 left-[20%] right-[20%] h-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(ellipse, ${card.glowColor}, transparent)`, filter: "blur(20px)" }} />
        </div>
      ))}
    </div>
  );
}
