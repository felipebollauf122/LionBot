import { CardShell } from "./card-shell";
import type { DayPoint } from "@/lib/actions/analytics-actions";

const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Smooth-ish area line of revenue over the last 7 days. Pure SVG. */
export function RevenueChart({ data }: { data: DayPoint[] }) {
  const W = 600;
  const H = 200;
  const pad = 8;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const n = data.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  const points = data.map((d, i) => `${x(i)},${y(d.revenue)}`);
  const linePath = points.length ? `M ${points.join(" L ")}` : "";
  const areaPath = points.length ? `M ${x(0)},${H - pad} L ${points.join(" L ")} L ${x(n - 1)},${H - pad} Z` : "";

  const total = data.reduce((s, d) => s + d.revenue, 0);

  return (
    <CardShell
      title="Seu Desempenho"
      subtitle="Receita · últimos 7 dias"
      accent="magenta"
      right={<span className="stat-value text-sm text-(--accent)">{brl(total)}</span>}
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      }
    >
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" preserveAspectRatio="none">
          <defs>
            <linearGradient id="rev-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,43,214,0.30)" />
              <stop offset="100%" stopColor="rgba(255,43,214,0)" />
            </linearGradient>
            <linearGradient id="rev-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--cyan)" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill="url(#rev-area)" />}
          {linePath && (
            <path
              className="draw-line"
              d={linePath}
              fill="none"
              stroke="url(#rev-line)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 6px var(--accent-glow))" }}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {data.map((d, i) => (
            <circle key={i} cx={x(i)} cy={y(d.revenue)} r={3} fill="var(--cyan)" className="num-pop" style={{ filter: "drop-shadow(0 0 4px var(--cyan-glow))", animationDelay: `${0.6 + i * 0.08}s` }} />
          ))}
        </svg>
        <div className="flex justify-between mt-1 px-1">
          {data.map((d, i) => (
            <span key={i} className="text-[9px] text-(--text-ghost)">{WD[new Date(d.date + "T12:00:00").getDay()]}</span>
          ))}
        </div>
      </div>
    </CardShell>
  );
}
