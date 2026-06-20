"use client";

import { useState } from "react";
import { CardShell } from "./card-shell";
import type { DayPoint } from "@/lib/actions/analytics-actions";

const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fullDate(key: string) {
  // "YYYY-MM-DD" → "dom, 08 de jun"
  return new Date(key + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}

/** Linha de receita por dia. Hover/clique nas bolinhas mostra o valor exato do dia.
 * `total` (opcional) é o total a exibir no canto — passe a receita AGREGADA do
 * período quando a linha estiver capada (senão o canto somaria só os dias plotados). */
export function RevenueChart({ data, subtitle = "Receita · últimos 7 dias", total: totalProp }: { data: DayPoint[]; subtitle?: string; total?: number }) {
  const W = 600;
  const H = 200;
  const pad = 8;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const n = data.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  // posição em % do container (o SVG usa preserveAspectRatio="none", então o
  // tooltip HTML deve ser posicionado pela fração da caixa, não por coord SVG).
  const xPct = (i: number) => (x(i) / W) * 100;
  const yPct = (v: number) => (y(v) / H) * 100;

  const points = data.map((d, i) => `${x(i)},${y(d.revenue)}`);
  const linePath = points.length ? `M ${points.join(" L ")}` : "";
  const areaPath = points.length ? `M ${x(0)},${H - pad} L ${points.join(" L ")} L ${x(n - 1)},${H - pad} Z` : "";

  // canto: usa o total do período (se passado); senão soma os pontos plotados.
  const total = totalProp ?? data.reduce((s, d) => s + d.revenue, 0);

  // ponto ativo (hover / clique / toque).
  const [active, setActive] = useState<number | null>(null);
  const act = active !== null ? data[active] : null;

  return (
    <CardShell
      title="Seu Desempenho"
      subtitle={subtitle}
      accent="magenta"
      className="h-full"
      right={<span className="stat-value text-sm text-(--accent)">{brl(total)}</span>}
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      }
    >
      <div className="relative h-full flex flex-col">
        <div className="relative flex-1 min-h-44">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="rev-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 30%, transparent)" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 0%, transparent)" />
              </linearGradient>
              <linearGradient id="rev-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="var(--cyan)" />
              </linearGradient>
            </defs>
            {areaPath && <path d={areaPath} fill="url(#rev-area)" />}
            {/* guia vertical do ponto ativo */}
            {active !== null && (
              <line x1={x(active)} y1={pad} x2={x(active)} y2={H - pad} stroke="var(--cyan)" strokeWidth={1} strokeDasharray="3 3" opacity={0.4} vectorEffect="non-scaling-stroke" />
            )}
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
              <circle
                key={i}
                cx={x(i)}
                cy={y(d.revenue)}
                r={active === i ? 5 : 3}
                fill="var(--cyan)"
                className={active === null ? "num-pop" : undefined}
                style={{ filter: "drop-shadow(0 0 4px var(--cyan-glow))", animationDelay: `${0.6 + i * 0.08}s`, transition: "r 0.12s" }}
              />
            ))}
            {/* faixas de toque/hover largas por dia (fáceis de acertar, inclusive no mobile) */}
            {data.map((d, i) => {
              const left = i === 0 ? 0 : (x(i - 1) + x(i)) / 2;
              const right = i === n - 1 ? W : (x(i) + x(i + 1)) / 2;
              return (
                <rect
                  key={`hit-${i}`}
                  x={left}
                  y={0}
                  width={Math.max(0, right - left)}
                  height={H}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
                  onClick={() => setActive((cur) => (cur === i ? null : i))}
                  onTouchStart={() => setActive(i)}
                />
              );
            })}
          </svg>

          {/* Tooltip HTML por cima — posicionado pela % real da bolinha */}
          {act && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
              style={{ left: `${xPct(active!)}%`, top: `calc(${yPct(act.revenue)}% - 10px)` }}
            >
              <div className="rounded-lg border border-(--border-subtle) bg-[#0b0b12]/95 px-3 py-2 shadow-xl backdrop-blur-sm whitespace-nowrap">
                <p className="text-[10px] uppercase tracking-wide text-(--text-ghost)">{fullDate(act.date)}</p>
                <p className="stat-value text-sm text-(--cyan) leading-tight">{brl(act.revenue)}</p>
                <p className="text-[10px] text-(--text-muted)">{act.sales} venda{act.sales !== 1 ? "s" : ""}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-1 px-1">
          {data.map((d, i) => {
            // rareia rótulos em períodos longos (≤ ~7 marcas) — senão 31 letras coladas.
            const step = Math.max(1, Math.ceil(n / 7));
            const show = active === i || i === n - 1 || i % step === 0;
            return (
              <span key={i} className={`text-[9px] transition-colors ${active === i ? "text-(--cyan)" : "text-(--text-ghost)"}`}>
                {show ? WD[new Date(d.date + "T12:00:00").getDay()] : ""}
              </span>
            );
          })}
        </div>
      </div>
    </CardShell>
  );
}
