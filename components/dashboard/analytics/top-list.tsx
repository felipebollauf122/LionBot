import { CardShell } from "./card-shell";
import type { ReactNode } from "react";

export interface TopListRow {
  id: string;
  label: string;
  /** primary value already formatted (e.g. "R$ 22,90") */
  value: string;
  /** optional secondary line (e.g. "2 vendas") */
  sub?: string;
}

interface TopListProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  accent?: "magenta" | "cyan" | "purple" | "amber";
  rows: TopListRow[];
  emptyLabel?: string;
}

export function TopList({ title, subtitle, icon, accent = "magenta", rows, emptyLabel = "Sem dados ainda" }: TopListProps) {
  return (
    <CardShell title={title} subtitle={subtitle} icon={icon} accent={accent}>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-(--text-ghost) text-xs">{emptyLabel}</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
            >
              <span
                className="w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold stat-value"
                style={{ background: "color-mix(in srgb, var(--amber) 16%, transparent)", color: "var(--amber)" }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-(--text-secondary) truncate font-medium">{r.label}</p>
                {r.sub && <p className="text-[10px] text-(--text-ghost) stat-value">{r.sub}</p>}
              </div>
              <span className="text-xs font-bold stat-value text-(--cyan) shrink-0">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}
