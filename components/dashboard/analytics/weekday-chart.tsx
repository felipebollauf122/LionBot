import { CardShell } from "./card-shell";
import type { WeekdayPoint } from "@/lib/actions/analytics-actions";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function WeekdayChart({ data, todayIdx = -1 }: { data: WeekdayPoint[]; todayIdx?: number }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.current, d.previous]));
  const thisWeek = data.reduce((s, d) => s + d.current, 0);
  const lastWeek = data.reduce((s, d) => s + d.previous, 0);
  const diff = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : thisWeek > 0 ? 100 : 0;

  return (
    <CardShell
      title="Vendas por Dia da Semana"
      subtitle="Análise semanal · esta vs passada"
      accent="purple"
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      }
    >
      <div className="flex items-end justify-between gap-3 h-44 px-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
            <div className="w-full flex items-end justify-center gap-1 h-full">
              {/* previous week (ghost) */}
              <div
                className="w-1/3 rounded-t bar-grow"
                style={{ height: `${(d.previous / max) * 100}%`, background: "rgba(255,255,255,0.08)", animationDelay: `${i * 0.06}s` }}
                title={`Semana passada: ${d.previous}`}
              />
              {/* this week (neon) */}
              <div
                className="w-1/3 rounded-t bar-grow transition-[filter] hover:brightness-125"
                style={{
                  height: `${Math.max(2, (d.current / max) * 100)}%`,
                  background: i === todayIdx ? "linear-gradient(180deg, var(--accent), var(--purple))" : "linear-gradient(180deg, var(--cyan), color-mix(in srgb,var(--cyan) 40%, transparent))",
                  boxShadow: i === todayIdx ? "0 0 14px -4px var(--accent-glow)" : "0 0 10px -6px var(--cyan-glow)",
                  animationDelay: `${i * 0.06 + 0.05}s`,
                }}
                title={`Esta semana: ${d.current}`}
              />
            </div>
            <span className={`text-[10px] ${i === todayIdx ? "text-(--accent) font-bold" : "text-(--text-ghost)"}`}>{DAYS[i]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 pt-3 mt-2 border-t border-(--border-subtle)">
        <div className="text-center"><p className="stat-value text-sm text-(--cyan)">{thisWeek}</p><p className="text-[9px] text-(--text-ghost)">Esta semana</p></div>
        <div className="text-center"><p className="stat-value text-sm text-(--text-muted)">{lastWeek}</p><p className="text-[9px] text-(--text-ghost)">Sem. passada</p></div>
        <div className="text-center"><p className={`stat-value text-sm ${diff >= 0 ? "text-(--cyan)" : "text-(--red)"}`}>{diff >= 0 ? "+" : ""}{diff.toFixed(0)}%</p><p className="text-[9px] text-(--text-ghost)">Diferença</p></div>
      </div>
    </CardShell>
  );
}
