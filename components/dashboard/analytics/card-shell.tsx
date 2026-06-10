import type { ReactNode } from "react";

interface CardShellProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  accent?: "magenta" | "cyan" | "purple" | "amber";
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

const COLOR = {
  magenta: "var(--accent)",
  cyan: "var(--cyan)",
  purple: "var(--purple)",
  amber: "var(--amber)",
};

/** Standard synthwave panel with an icon header — used across analytics widgets. */
export function CardShell({ title, subtitle, icon, accent = "magenta", right, children, className }: CardShellProps) {
  const color = COLOR[accent];
  return (
    <div className={`card p-5 relative flex flex-col ${className ?? ""}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div
              className="section-icon w-9 h-9 shrink-0"
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
    </div>
  );
}
