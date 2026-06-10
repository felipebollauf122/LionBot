"use client";

import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** cell renderer */
  cell: (row: T) => ReactNode;
  /** hide below sm */
  secondary?: boolean;
  /** right-align (numbers) */
  align?: "left" | "right" | "center";
  width?: string;
}

interface DataGridProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** id of the currently selected row (highlight) */
  selectedKey?: string | null;
  empty?: ReactNode;
}

/**
 * Dense operational grid: sticky header, ~36px rows, row-hover slide, click→drawer.
 * Replaces every stacked-card list and ad-hoc <table> in the app.
 */
export function DataGrid<T>({ columns, rows, rowKey, onRowClick, selectedKey, empty }: DataGridProps<T>) {
  if (rows.length === 0) {
    return <div className="py-16 text-center text-(--text-ghost) text-sm">{empty ?? "Nada por aqui ainda."}</div>;
  }

  const align = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[320px] sm:min-w-[480px]">
        <thead className="sticky top-0 z-10 bg-(--bg-surface)/95 backdrop-blur-sm">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`table-header ${align(c.align)} ${c.secondary ? "hidden sm:table-cell" : ""} whitespace-nowrap`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey === key;
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`row-hover ${onRowClick ? "cursor-pointer" : ""} ${selected ? "bg-(--accent)/[0.06]" : ""}`}
                style={selected ? { boxShadow: "inset 2px 0 0 var(--accent)" } : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`table-cell ${align(c.align)} ${c.secondary ? "hidden sm:table-cell" : ""} whitespace-nowrap`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Section divider for grouped grids (e.g. Fluxos: Principal · Black · Outros). */
export function RowGroupHeader({ label, count, accent = "magenta" }: { label: string; count?: number; accent?: "magenta" | "cyan" | "purple" | "amber" }) {
  const color = { magenta: "var(--accent)", cyan: "var(--cyan)", purple: "var(--purple)", amber: "var(--amber)" }[accent];
  return (
    <div className="flex items-center gap-2.5 px-3 pt-5 pb-2">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color }}>{label}</span>
      {typeof count === "number" && <span className="text-[10px] text-(--text-ghost) stat-value">({count})</span>}
      <div className="flex-1 h-px bg-gradient-to-r from-(--border-default) to-transparent ml-2" />
    </div>
  );
}
