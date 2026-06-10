"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { FilterOptions } from "@/lib/actions/analytics-actions";

const PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "Semana" },
  { key: "30d", label: "Mês" },
  { key: "all", label: "Tudo" },
];

export function FilterBar({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const period = params.get("period") ?? "today";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  function clearAll() {
    router.push(pathname);
  }

  const hasFilters = ["botId", "flowId", "gateway", "source"].some((k) => params.get(k));

  return (
    <div className="space-y-3">
      {/* Period toggle */}
      <div className="flex justify-end">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-(--border-subtle)">
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
      <div className="flex flex-wrap items-center gap-3">
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
    <select className="input max-w-52 text-xs py-2!" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
