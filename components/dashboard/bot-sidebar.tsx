"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LionMark } from "@/components/brand/lion-mark";

interface BotSidebarProps {
  botId: string;
  botUsername: string;
  avatarUrl?: string | null;
  basePath?: string;
  open?: boolean;
  onClose?: () => void;
}

export const botNavItems = [
  { label: "Fluxos", segment: "flows", icon: "M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1013 16H2m16-8a2 2 0 10-2-2H2", color: "var(--accent)" },
  { label: "Produtos", segment: "products", icon: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01", color: "var(--accent)" },
  { label: "Conjuntos", segment: "bundles", icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z", color: "var(--purple)" },
  { label: "Mídia", segment: "media", icon: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z", color: "var(--cyan)" },
  { label: "Prova Social", segment: "prova-social", icon: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0", color: "var(--purple)" },
  { label: "Leads", segment: "leads", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", color: "var(--cyan)" },
  { label: "Clientes", segment: "clientes", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", color: "var(--accent)" },
  { label: "Transacoes", segment: "transactions", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--accent)" },
  { label: "Pagou s/ receber", segment: "orphaned-transactions", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01", color: "var(--red)" },
  { label: "Remarketing", segment: "remarketing", icon: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15", color: "var(--amber)" },
  { label: "Tracking", segment: "tracking", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--cyan)" },
  { label: "Configuracoes", segment: "settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z", color: "var(--text-secondary)" },
];

/**
 * BotRail — a 64px icon rail that replaces the old 240px bot sidebar.
 * Hover expands it to ~228px as an overlay (doesn't push the content).
 * On mobile it's the off-canvas drawer (open/onClose), fully expanded.
 */
export function BotSidebar({ botId, botUsername, avatarUrl, basePath: baseProp, open = false, onClose }: BotSidebarProps) {
  const pathname = usePathname();
  const base = baseProp ?? `/dashboard/bots/${botId}`;
  const backUrl = baseProp ? baseProp.replace(/\/bots\/.*$/, "") : "/dashboard";

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <aside
      className={`group/rail z-50 flex flex-col shrink-0
        fixed md:sticky inset-y-0 left-0 top-0 h-screen md:self-start transition-all duration-300 ease-out
        w-[228px] md:w-16 md:hover:w-[228px]
        ${open ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
      style={{ background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)" }}
    >
      {/* Right border + glow */}
      <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-(--border-default) to-transparent" />

      {/* Header: back + avatar/username */}
      <div className="h-16 pt-safe box-content flex items-center gap-2.5 px-3 relative shrink-0 overflow-hidden">
        <a
          href={backUrl}
          aria-label="Voltar"
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <LionMark size={30} glow={false} />
          )}
        </a>
        <div className="min-w-0 md:opacity-0 md:group-hover/rail:opacity-100 transition-opacity duration-200">
          <h2 className="text-sm font-bold text-foreground truncate tracking-tight">@{botUsername}</h2>
          <span className="text-[9px] uppercase tracking-wider text-(--text-ghost)">voltar aos bots</span>
        </div>
      </div>

      <div className="h-px mx-3 bg-gradient-to-r from-transparent via-(--border-default) to-transparent shrink-0" />

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto overflow-x-hidden">
        <div className="space-y-1">
          {botNavItems.map((item) => {
            const href = `${base}/${item.segment}`;
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <a
                key={item.segment}
                href={href}
                title={item.label}
                className={`relative flex items-center gap-3 h-10 px-1.5 rounded-xl transition-all
                  ${isActive ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"}`}
              >
                {/* active accent bar */}
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r" style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} />
                )}
                <div
                  className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-all"
                  style={isActive ? { background: `color-mix(in srgb, ${item.color} 16%, transparent)`, boxShadow: `0 0 10px -4px ${item.color}` } : { background: "rgba(255,255,255,0.03)" }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isActive ? item.color : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={item.icon} />
                  </svg>
                </div>
                <span
                  className={`text-[13px] font-medium truncate whitespace-nowrap transition-opacity duration-200
                    md:opacity-0 md:group-hover/rail:opacity-100
                    ${isActive ? "text-foreground" : "text-(--text-secondary)"}`}
                >
                  {item.label}
                </span>
              </a>
            );
          })}
        </div>
      </nav>

      {/* Meu Perfil — fixo no rodapé do rail */}
      <div className="px-2.5 py-3 mt-auto border-t border-(--border-subtle)">
        <a
          href="/dashboard/profile"
          title="Meu Perfil"
          className="relative flex items-center gap-3 h-10 px-1.5 rounded-xl transition-all hover:bg-white/[0.03]"
        >
          <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <span className="text-[13px] font-medium truncate whitespace-nowrap text-(--text-secondary) transition-opacity duration-200 md:opacity-0 md:group-hover/rail:opacity-100">
            Meu Perfil
          </span>
        </a>
      </div>
    </aside>
  );
}
