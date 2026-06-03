"use client";

import { usePathname } from "next/navigation";

interface BotSidebarProps {
  botId: string;
  botUsername: string;
  avatarUrl?: string | null;
  basePath?: string;
}

const botNavItems = [
  { label: "Fluxos", segment: "flows", icon: "M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1013 16H2m16-8a2 2 0 10-2-2H2", color: "var(--accent)" },
  { label: "Produtos", segment: "products", icon: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01", color: "var(--accent)" },
  { label: "Conjuntos", segment: "bundles", icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z", color: "var(--purple)" },
  { label: "Leads", segment: "leads", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", color: "var(--cyan)" },
  { label: "Transacoes", segment: "transactions", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--accent)" },
  { label: "Pagou s/ receber", segment: "orphaned-transactions", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01", color: "var(--red)" },
  { label: "Remarketing", segment: "remarketing", icon: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15", color: "var(--amber)" },
  { label: "Tracking", segment: "tracking", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--cyan)" },
  { label: "Configuracoes", segment: "settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z", color: "var(--text-secondary)" },
];

export function BotSidebar({ botId, botUsername, avatarUrl, basePath: baseProp }: BotSidebarProps) {
  const pathname = usePathname();
  const base = baseProp ?? `/dashboard/bots/${botId}`;
  const backUrl = baseProp ? baseProp.replace(/\/bots\/.*$/, "") : "/dashboard";

  return (
    <aside className="w-60 min-h-screen flex flex-col relative" style={{ background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)" }}>
      {/* Right border */}
      <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-(--border-default) to-transparent" />

      {/* Ambient glow */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-(--accent)/3 to-transparent pointer-events-none" />

      {/* Bot header */}
      <div className="px-4 pt-5 pb-4 relative">
        <a
          href={backUrl}
          className="inline-flex items-center gap-2 text-(--text-muted) hover:text-foreground text-xs transition-all mb-4 group"
        >
          <div className="w-6 h-6 rounded-md bg-white/4 flex items-center justify-center group-hover:bg-white/8 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </div>
          Voltar
        </a>
        <div className="flex items-center gap-2.5">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <img src="/logo.png" alt="" className="w-8 h-8 object-contain drop-shadow-[0_0_6px_rgba(34,211,238,0.2)]" />
          )}
          <h2 className="text-sm font-bold text-foreground truncate tracking-tight">
            @{botUsername}
          </h2>
        </div>

        {/* Separator */}
        <div className="absolute bottom-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-(--border-default) to-transparent" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2.5 pt-4 pb-3">
        <p className="text-(--text-ghost) text-[10px] font-bold uppercase tracking-[0.14em] px-3 mb-3">
          Gerenciar
        </p>
        <div className="space-y-0.5">
          {botNavItems.map((item) => {
            const href = `${base}/${item.segment}`;
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <a
                key={item.segment}
                href={href}
                className={`nav-item ${isActive ? "active" : ""}`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${isActive ? "" : "bg-white/4"}`}
                  style={isActive ? { background: `color-mix(in srgb, ${item.color} 15%, transparent)`, boxShadow: `0 0 10px -4px ${item.color}` } : {}}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isActive ? item.color : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={item.icon} />
                  </svg>
                </div>
                {item.label}
              </a>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
