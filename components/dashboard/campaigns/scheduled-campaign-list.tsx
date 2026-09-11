import { AutomationLink } from "@/components/dashboard/automations/scoped-link";
const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: "RASCUNHO", badge: "badge-inactive" },
  ai_processing: { label: "IA", badge: "badge-info" },
  running: { label: "PUBLICANDO", badge: "badge-info" },
  paused: { label: "PAUSADA", badge: "badge-pending" },
  completed: { label: "CONCLUÍDA", badge: "badge-active" },
  failed: { label: "FALHOU", badge: "badge-error" },
};

/** Início da campanha em pt-BR. Sem data ainda, o traço — melhor que inventar. */
function formatarInicio(iso: string | null): string {
  if (!iso) return "sem data de início";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "sem data de início" : d.toLocaleString("pt-BR");
}

// Renderiza SÓ as linhas — a page envolve num CardShell, igual ao CloneList.
export function ScheduledCampaignList({
  campaigns,
}: {
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    dest_title: string | null;
    total_messages: number;
    sent_count: number;
    failed_count: number;
    start_at: string | null;
  }>;
}) {
  if (campaigns.length === 0) {
    return (
      <div className="py-8 text-center text-(--text-ghost) text-xs">
        Nenhuma campanha ainda — clone um canal no modo rascunho ou crie uma do zero.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {campaigns.map((c, i) => {
        const meta = STATUS_MAP[c.status] ?? {
          label: c.status.toUpperCase(),
          badge: "badge-inactive",
        };
        const pct =
          c.total_messages > 0
            ? Math.min(100, Math.round((c.sent_count / c.total_messages) * 100))
            : 0;

        return (
          <AutomationLink
            key={c.id}
            href={`/dashboard/automations/scheduled/${c.id}`}
            className={`row-hover reveal-${Math.min(i + 1, 8)} block px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) hover:border-(--border-default) transition-colors`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground font-medium truncate">{c.name}</span>
              <span className={`badge ${meta.badge} shrink-0`}>{meta.label}</span>
            </div>
            <div className="text-sm text-(--text-ghost) truncate mt-0.5">
              em {c.dest_title ?? "destino não escolhido"} · {formatarInicio(c.start_at)}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full origin-left rounded-full"
                  style={{
                    transform: `scaleX(${pct / 100})`,
                    background: "linear-gradient(90deg, var(--accent), var(--cyan))",
                    transition: "transform 250ms ease-out",
                  }}
                />
              </div>
              <span className="text-sm font-bold stat-value text-(--text-secondary) shrink-0">
                {c.sent_count}/{c.total_messages} enviadas
              </span>
            </div>
            {c.failed_count > 0 && (
              <div className="text-sm text-(--red) mt-1">
                {c.failed_count} falhou(ram)
              </div>
            )}
          </AutomationLink>
        );
      })}
    </div>
  );
}
