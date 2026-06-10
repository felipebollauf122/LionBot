import { CardShell } from "./card-shell";
import { icons } from "./icons";
import type { ActivityItem } from "@/lib/actions/analytics-actions";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const KIND = {
  lead: { color: "var(--cyan)", icon: icons.users },
  pix: { color: "var(--amber)", icon: icons.bolt },
  sale: { color: "var(--accent)", icon: icons.money },
};

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <CardShell
      title="Log de Atividades"
      subtitle="tempo real"
      accent="cyan"
      icon={icons.activity}
      className="h-full"
    >
      {items.length === 0 ? (
        <div className="py-10 text-center text-(--text-ghost) text-xs">Nenhuma atividade ainda</div>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {items.map((it, i) => {
            const k = KIND[it.kind];
            return (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
                <div
                  className="section-icon w-7 h-7 shrink-0"
                  style={{ background: `color-mix(in srgb, ${k.color} 14%, transparent)`, color: k.color }}
                >
                  {k.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground font-medium truncate">{it.title}</p>
                  <p className="text-[10px] text-(--text-muted) truncate">{it.detail}</p>
                </div>
                <div className="text-right shrink-0">
                  {typeof it.amount === "number" && it.kind !== "lead" && (
                    <p className="text-[11px] font-bold stat-value" style={{ color: k.color }}>{brl(it.amount)}</p>
                  )}
                  <p className="text-[10px] text-(--text-ghost) stat-value">{relativeTime(it.at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}
