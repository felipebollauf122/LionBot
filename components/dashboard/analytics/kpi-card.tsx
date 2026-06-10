import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: string;
  /** small sub-line under the value (e.g. "50% de aprovação") */
  hint?: string;
  /** delta badge text (e.g. "+100%") */
  delta?: string;
  deltaUp?: boolean;
  icon?: ReactNode;
  accent?: "magenta" | "cyan" | "purple" | "amber";
  /** 0..1 progress bar under the value */
  progress?: number;
}

const ACCENTS = {
  magenta: { color: "var(--accent)", glow: "var(--accent-glow)" },
  cyan: { color: "var(--cyan)", glow: "var(--cyan-glow)" },
  purple: { color: "var(--purple)", glow: "var(--purple-glow)" },
  amber: { color: "var(--amber)", glow: "var(--amber-glow)" },
};

export function KpiCard({ label, value, hint, delta, deltaUp, icon, accent = "magenta", progress }: KpiCardProps) {
  const a = ACCENTS[accent];
  return (
    <div className="card p-5 relative overflow-hidden group">
      <div className="flex items-start justify-between mb-4">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-(--text-muted)">{label}</span>
        {icon && (
          <div
            className="section-icon w-8 h-8 shrink-0"
            style={{ background: `color-mix(in srgb, ${a.color} 12%, transparent)`, boxShadow: `0 0 12px -4px ${a.glow}`, color: a.color }}
          >
            {icon}
          </div>
        )}
      </div>
      <p className="stat-value text-3xl mb-1" style={{ color: a.color, textShadow: `0 0 18px ${a.glow}` }}>
        {value}
      </p>
      {(hint || delta) && (
        <div className="flex items-center gap-2 mt-2">
          {delta && (
            <span className={`text-[11px] font-bold stat-value ${deltaUp ? "text-(--cyan)" : "text-(--red)"}`}>
              {deltaUp ? "↑" : "↓"} {delta}
            </span>
          )}
          {hint && <span className="text-[11px] text-(--text-muted)">{hint}</span>}
        </div>
      )}
      {typeof progress === "number" && (
        <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%`, background: `linear-gradient(90deg, ${a.color}, var(--cyan))`, boxShadow: `0 0 8px ${a.glow}` }}
          />
        </div>
      )}
    </div>
  );
}
