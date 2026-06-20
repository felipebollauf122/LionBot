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

export function PeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const period = params.get("period") ?? "7d";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";

  function pushParams(mut: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mut(next);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function selectPeriod(key: string) {
    pushParams((p) => {
      // "all" precisa ser EXPLÍCITO na URL — o default da página é "today", então
      // deletar o param fazia "Tudo" cair em "hoje" (e mostrar zero).
      p.set("period", key);
      if (key !== "custom") {
        p.delete("startDate");
        p.delete("endDate");
      }
    });
  }

  function setDate(which: "startDate" | "endDate", value: string) {
    pushParams((p) => {
      p.set("period", "custom");
      if (value) p.set(which, value);
      else p.delete(which);
    });
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
