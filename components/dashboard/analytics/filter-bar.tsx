"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { FilterOptions } from "@/lib/actions/analytics-actions";

const PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "Semana" },
  { key: "30d", label: "Mês" },
  { key: "all", label: "Tudo" },
  { key: "custom", label: "Personalizado" },
];

export function FilterBar({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const period = params.get("period") ?? "7d";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    // period="all" precisa ir EXPLÍCITO (o default da página é "today", então
    // deletar fazia "Tudo" virar "hoje"). Pros dropdowns, "all"/vazio = limpar.
    if (key === "period") next.set(key, value || "today");
    else if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    // ao sair do custom, limpa as datas pra não ficarem penduradas na URL.
    if (key === "period" && value !== "custom") {
      next.delete("startDate");
      next.delete("endDate");
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  function setCustomDate(which: "startDate" | "endDate", value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("period", "custom");
    if (value) next.set(which, value); else next.delete(which);
    const otherKey = which === "startDate" ? "endDate" : "startDate";
    const other = which === "startDate" ? endDate : startDate;
    if (other) next.set(otherKey, other);
    router.push(`${pathname}?${next.toString()}`);
  }

  function clearAll() {
    router.push(pathname);
  }

  const hasFilters = ["botId", "flowId", "gateway", "source"].some((k) => params.get(k));

  return (
    <div className="space-y-3">
      {/* Period toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
        {period === "custom" && (
          <div className="flex items-center gap-2 order-2 sm:order-1">
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setCustomDate("startDate", e.target.value)}
              className="input text-xs py-2! w-auto"
              aria-label="Data inicial"
            />
            <span className="text-(--text-muted) text-xs">até</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setCustomDate("endDate", e.target.value)}
              className="input text-xs py-2! w-auto"
              aria-label="Data final"
            />
          </div>
        )}
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-white/[0.02] border border-(--border-subtle) order-1 sm:order-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setParam("period", p.key)}
              className={`toggle-btn ${period === p.key ? "on" : "off"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dropdown filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        <Select label="Todos os Bots" value={params.get("botId") ?? ""} onChange={(v) => setParam("botId", v)} options={options.bots.map((b) => ({ value: b.id, label: b.label }))} />
        <Select label="Todos os Fluxos" value={params.get("flowId") ?? ""} onChange={(v) => setParam("flowId", v)} options={options.flows.map((f) => ({ value: f.id, label: f.label }))} />
        <Select label="Todos os Gateways" value={params.get("gateway") ?? ""} onChange={(v) => setParam("gateway", v)} options={options.gateways.map((g) => ({ value: g, label: g }))} />
        <Select label="Todas as Fontes" value={params.get("source") ?? ""} onChange={(v) => setParam("source", v)} options={options.sources.map((s) => ({ value: s, label: s }))} />
        {hasFilters && (
          <button onClick={clearAll} className="ml-auto text-xs text-(--text-muted) hover:text-(--red) transition-colors flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select className="input w-full sm:w-auto sm:max-w-52 text-xs py-2!" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
