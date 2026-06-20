"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Filtro de PERÍODO reutilizável (usado na Dashboard). Presets + "Personalizado"
 * (dois date inputs). Tudo via URL (?period=...&startDate=...&endDate=...), então
 * a página server lê os searchParams e re-renderiza com os dados filtrados —
 * mesmo mecanismo do FilterBar das Análises.
 */

const PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "all", label: "Tudo" },
  { key: "custom", label: "Personalizado" },
];

export interface PeriodValue {
  period: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Dois modos:
 * - CONTROLADO (Dashboard): recebe `value` + `onChange` → troca de período é
 *   100% no cliente (instantânea, sem round-trip). Não toca na URL.
 * - URL (Análises): sem props → lê/escreve searchParams via router (re-render server).
 */
export function PeriodFilter({ value, onChange }: { value?: PeriodValue; onChange?: (v: PeriodValue) => void } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const controlled = !!onChange;

  const period = controlled ? (value?.period ?? "7d") : (params.get("period") ?? "7d");
  const startDate = controlled ? (value?.startDate ?? "") : (params.get("startDate") ?? "");
  const endDate = controlled ? (value?.endDate ?? "") : (params.get("endDate") ?? "");

  function apply(next: PeriodValue) {
    if (controlled) { onChange!(next); return; }
    const p = new URLSearchParams(params.toString());
    p.set("period", next.period);
    if (next.startDate) p.set("startDate", next.startDate); else p.delete("startDate");
    if (next.endDate) p.set("endDate", next.endDate); else p.delete("endDate");
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function selectPeriod(key: string) {
    apply(key === "custom" ? { period: "custom", startDate, endDate } : { period: key });
  }

  function setDate(which: "startDate" | "endDate", v: string) {
    apply({ period: "custom", startDate: which === "startDate" ? v : startDate, endDate: which === "endDate" ? v : endDate });
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-white/[0.02] border border-(--border-subtle)">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => selectPeriod(p.key)}
            className={`toggle-btn ${period === p.key ? "on" : "off"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => setDate("startDate", e.target.value)}
            className="input text-xs py-2! w-auto"
            aria-label="Data inicial"
          />
          <span className="text-(--text-muted) text-xs">até</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setDate("endDate", e.target.value)}
            className="input text-xs py-2! w-auto"
            aria-label="Data final"
          />
        </div>
      )}
    </div>
  );
}
