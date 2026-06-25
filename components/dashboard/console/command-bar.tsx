"use client";

import type { ReactNode } from "react";

interface CommandBarProps {
  title: ReactNode;
  subtitle?: string;
  /** search input slot (centre) */
  search?: ReactNode;
  /** filter chips (centre, after search) */
  filters?: ReactNode;
  /** compact KPI pills (right, before action) */
  kpis?: ReactNode;
  /** primary action button(s) (right) */
  action?: ReactNode;
}

/**
 * The single sticky header that replaces every per-screen "h1 + subtitle + buttons".
 * Layout: title (left) · search + filter chips (centre) · KPIs + primary action (right).
 * Collapses gracefully on mobile (stacks).
 */
export function CommandBar({ title, subtitle, search, filters, kpis, action }: CommandBarProps) {
  // overflow-x-clip: corta só horizontal (mobile não vaza), mas deixa o dropdown
  // do AdminViewSwitcher escapar pra baixo (overflow-hidden cortaria).
  return (
    <div className="sticky top-0 z-20 glass border-b border-(--border-subtle) px-4 sm:px-6 py-3 pt-safe overflow-x-clip">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5 min-w-0">
        {/* Title */}
        <div className="min-w-0 shrink-0">
          {typeof title === "string" ? (
            <h1 className="text-lg sm:text-xl font-bold tracking-tight page-title truncate">{title}</h1>
          ) : (
            title
          )}
          {subtitle && <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">{subtitle}</p>}
        </div>

        {/* Centre: search + filters */}
        {(search || filters) && (
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
            {search}
            {filters}
          </div>
        )}

        {/* Right: KPIs + action */}
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {kpis && <div className="hidden lg:flex items-center gap-2">{kpis}</div>}
          {action}
        </div>
      </div>
    </div>
  );
}

/** Compact KPI for the command bar. */
export function KpiPill({ label, value, accent = "magenta" }: { label: string; value: string; accent?: "magenta" | "cyan" | "purple" | "amber" | "red" }) {
  const color = {
    magenta: "var(--accent)",
    cyan: "var(--cyan)",
    purple: "var(--purple)",
    amber: "var(--amber)",
    red: "var(--red)",
  }[accent];
  return (
    <div className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-(--border-subtle) flex flex-col items-end leading-tight">
      <span className="stat-value text-sm num-pop" style={{ color }}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-(--text-ghost)">{label}</span>
    </div>
  );
}

/** Toggleable filter chip. */
export function FilterChip({ active, onClick, children, count }: { active?: boolean; onClick?: () => void; children: ReactNode; count?: number }) {
  return (
    <button onClick={onClick} className={`toggle-btn ${active ? "on" : "off"} text-[11px]! py-1.5! flex items-center gap-1.5`}>
      {children}
      {typeof count === "number" && (
        <span className="px-1.5 rounded-full bg-white/10 text-[9px] stat-value">{count}</span>
      )}
    </button>
  );
}

/** Search input styled for the command bar. */
export function CommandSearch({ value, onChange, placeholder = "Buscar..." }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 min-w-[160px] max-w-sm">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-10! py-2! text-sm"
      />
    </div>
  );
}
