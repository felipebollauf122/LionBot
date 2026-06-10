import type { ReactNode } from "react";

interface ComingSoonCardProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** short note about why it's not live yet */
  note?: string;
  className?: string;
}

/**
 * Placeholder for widgets whose data source doesn't exist in the backend yet
 * (ranking de players, geolocalização, dispositivos, meta, etc.).
 * Keeps the full layout without faking numbers — shows an honest "Em breve".
 */
export function ComingSoonCard({ title, subtitle, icon, note, className }: ComingSoonCardProps) {
  return (
    <div className={`card p-5 relative flex flex-col overflow-hidden ${className ?? ""}`}>
      {/* faint scanline texture to read as "offline panel" */}
      <div className="absolute inset-0 scanlines opacity-60 pointer-events-none" />
      <div className="flex items-start justify-between mb-4 relative">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="section-icon w-9 h-9 shrink-0 opacity-50" style={{ background: "color-mix(in srgb, var(--purple) 8%, transparent)", color: "var(--text-muted)" }}>
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-(--text-secondary) font-semibold text-sm tracking-tight truncate">{title}</h3>
            {subtitle && <p className="text-[10px] uppercase tracking-[0.12em] text-(--text-ghost)">{subtitle}</p>}
          </div>
        </div>
        <span className="badge badge-purple shrink-0">Em breve</span>
      </div>
      <div className="flex-1 min-h-[88px] flex flex-col items-center justify-center text-center relative">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <p className="text-[11px] text-(--text-muted) max-w-[200px]">{note ?? "Disponível em breve com novos dados."}</p>
      </div>
    </div>
  );
}
