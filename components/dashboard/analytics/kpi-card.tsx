import type { ReactNode } from "react";
import { InteractiveCard } from "./interactive-card";
import { AnimatedNumber, type NumberFormat } from "./animated-number";

interface KpiCardProps {
  label: string;
  /** pre-formatted display value (used when numericValue is not given) */
  value: string;
  /** raw number to count-up; pair with `format` */
  numericValue?: number;
  /** serializable format kind (string, crosses RSC boundary) */
  format?: NumberFormat;
  hint?: string;
  delta?: string;
  deltaUp?: boolean;
  icon?: ReactNode;
  accent?: "magenta" | "cyan" | "purple" | "amber";
  /** 0..1 progress bar under the value */
  progress?: number;
  /** stagger reveal index 0..8 */
  revealIndex?: number;
}

const ACCENTS = {
  magenta: { color: "var(--accent)", glow: "var(--accent-glow)" },
  cyan: { color: "var(--cyan)", glow: "var(--cyan-glow)" },
  purple: { color: "var(--purple)", glow: "var(--purple-glow)" },
  amber: { color: "var(--amber)", glow: "var(--amber-glow)" },
};

export function KpiCard({
  label,
  value,
  numericValue,
  format,
  hint,
  delta,
  deltaUp,
  icon,
  accent = "magenta",
  progress,
  revealIndex,
}: KpiCardProps) {
  const a = ACCENTS[accent];
  const revealClass = typeof revealIndex === "number" ? `reveal-${Math.min(8, revealIndex)}` : "reveal";

  return (
    <InteractiveCard className={`group p-5 ${revealClass}`}>
      <div className="flex items-start justify-between mb-4">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-(--text-muted)">{label}</span>
        {icon && (
          <div
            className="section-icon w-8 h-8 shrink-0 icon-wobble"
            style={{ background: `color-mix(in srgb, ${a.color} 12%, transparent)`, boxShadow: `0 0 12px -4px ${a.glow}`, color: a.color }}
          >
            {icon}
          </div>
        )}
      </div>
      <p className="stat-value text-3xl mb-1 num-pop" style={{ color: a.color, textShadow: `0 0 18px ${a.glow}` }}>
        {typeof numericValue === "number" ? <AnimatedNumber value={numericValue} format={format} /> : value}
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
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              background: `linear-gradient(90deg, ${a.color}, var(--cyan))`,
              boxShadow: `0 0 8px ${a.glow}`,
              transition: "width 1s cubic-bezier(0.16,1,0.3,1)",
            }}
          />
        </div>
      )}
    </InteractiveCard>
  );
}
