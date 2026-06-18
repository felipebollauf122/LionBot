import type { ReactNode } from "react";
import { InteractiveCard } from "./interactive-card";

interface CardShellProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  accent?: "magenta" | "cyan" | "purple" | "amber";
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** stagger reveal index 0..8 */
  revealIndex?: number;
}

const COLOR = {
  magenta: "var(--accent)",
  cyan: "var(--cyan)",
  purple: "var(--purple)",
  amber: "var(--amber)",
};

/** Standard synthwave panel with an icon header — interactive (hover lift + sheen). */
export function CardShell({ title, subtitle, icon, accent = "magenta", right, children, className, revealIndex }: CardShellProps) {
  const color = COLOR[accent];
  const revealClass = typeof revealIndex === "number" ? `reveal-${Math.min(8, revealIndex)}` : "reveal";
  return (
    <InteractiveCard className={`group p-5 flex flex-col ${revealClass} ${className ?? ""}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div
              className="section-icon w-9 h-9 shrink-0 icon-wobble"
              style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, boxShadow: `0 0 12px -4px ${color}`, color }}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-foreground font-semibold text-sm tracking-tight truncate">{title}</h3>
            {subtitle && <p className="text-[10px] uppercase tracking-[0.12em] text-(--text-ghost)">{subtitle}</p>}
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </InteractiveCard>
  );
}
