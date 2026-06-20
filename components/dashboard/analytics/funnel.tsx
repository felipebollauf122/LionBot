import { CardShell } from "./card-shell";

interface Stage {
  label: string;
  count: number;
}

interface FunnelProps {
  starts: number;
  checkouts: number;
  paid: number;
  /** Rótulo do 1º estágio (default "/START"). Use "OFERTAS VISTAS" quando o topo vier de view_offer. */
  topLabel?: string;
  /** Se false, esconde o estágio "PIX GERADO" (quando não há checkout real) e mostra um funil de 2 etapas. */
  showCheckout?: boolean;
}

/** Funil de conversão neon. Adaptativo: sem checkout real, vira topo → pago (sem inventar PIX). */
export function Funnel({ starts, checkouts, paid, topLabel = "/START", showCheckout = true }: FunnelProps) {
  const stages: Stage[] = showCheckout
    ? [
        { label: topLabel, count: starts },
        { label: "PIX GERADO", count: checkouts },
        { label: "PAGO", count: paid },
      ]
    : [
        { label: topLabel, count: starts },
        { label: "PAGO", count: paid },
      ];

  const max = Math.max(starts, 1);
  const pct = (n: number) => (n / max) * 100;

  // métricas só com sentido real (sem cruzar etapas inexistentes).
  const metrics = showCheckout
    ? [
        { l: "Start → PIX", v: starts > 0 ? (checkouts / starts) * 100 : null },
        { l: "PIX → Pago", v: checkouts > 0 ? (paid / checkouts) * 100 : null },
        { l: "Conversão", v: starts > 0 ? (paid / starts) * 100 : null },
      ]
    : [{ l: `${topLabel.replace("/", "")} → Pago`, v: starts > 0 ? (paid / starts) * 100 : null }];

  return (
    <CardShell
      title="Funil de Conversão"
      subtitle="Jornada do usuário até a compra"
      accent="cyan"
      icon={
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      }
    >
      <div className="flex items-end justify-between gap-2 h-36 mb-3">
        {stages.map((s, i) => (
          <div key={s.label} className="flex-1 flex flex-col items-center justify-end h-full">
            <span className="stat-value text-sm text-foreground mb-1.5">{s.count.toLocaleString("pt-BR")}</span>
            <div
              className="w-full rounded-t-md bar-grow transition-[filter] hover:brightness-125"
              style={{
                height: `${Math.max(6, pct(s.count))}%`,
                background: `linear-gradient(180deg, color-mix(in srgb, var(--cyan) ${70 - i * 18}%, transparent), color-mix(in srgb, var(--accent) ${30 + i * 12}%, transparent))`,
                boxShadow: "0 0 16px -6px var(--cyan-glow)",
                animationDelay: `${i * 0.12}s`,
              }}
            />
            <span className="text-[9px] uppercase tracking-wider text-(--text-ghost) mt-2">{s.label}</span>
          </div>
        ))}
      </div>
      <div className={`grid gap-2 pt-3 border-t border-(--border-subtle) ${metrics.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
        {metrics.map((m) => (
          <div key={m.l} className="text-center">
            <p className="stat-value text-sm text-(--cyan)">{m.v === null ? "—" : `${m.v.toFixed(1)}%`}</p>
            <p className="text-[9px] text-(--text-ghost) mt-0.5">{m.l}</p>
          </div>
        ))}
      </div>
    </CardShell>
  );
}
