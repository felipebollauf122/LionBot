const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  running: { label: "RODANDO", badge: "badge-info" },
  waiting_flood: { label: "ESPERANDO", badge: "badge-info" },
  paused: { label: "PAUSADO", badge: "badge-pending" },
  completed: { label: "CONCLUÍDO", badge: "badge-active" },
  failed: { label: "FALHOU", badge: "badge-error" },
  draft: { label: "RASCUNHO", badge: "badge-inactive" },
};

export function CloneList({
  clones,
}: {
  clones: Array<{
    id: string;
    dest_title: string;
    source_title: string | null;
    status: string;
    copied_count: number;
    total_seen: number;
  }>;
}) {
  if (clones.length === 0) {
    return (
      <div className="card text-center text-(--text-muted) text-sm">
        Nenhum clone ainda — abra &quot;Ver conteúdo&quot; numa conta e clique em Clonar.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {clones.map((c, i) => {
        const meta =
          STATUS_MAP[c.status] ?? { label: c.status.toUpperCase(), badge: "badge-inactive" };
        const pct =
          c.total_seen > 0
            ? Math.min(100, Math.round((c.copied_count / c.total_seen) * 100))
            : c.status === "completed"
              ? 100
              : 0;
        return (
          <a
            key={c.id}
            href={`/dashboard/automations/clones/${c.id}`}
            className={`card-interactive block p-4 reveal-${Math.min(i + 1, 8)}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-(--text-primary) font-medium truncate">{c.dest_title}</div>
              <span className={`badge ${meta.badge} shrink-0`}>{meta.label}</span>
            </div>
            <div className="text-(--text-muted) text-xs truncate mt-0.5">
              de {c.source_title ?? "—"}
            </div>
            <div className="h-2 rounded-full bg-(--bg-input) overflow-hidden mt-2">
              <div
                style={{
                  width: `${pct}%`,
                  background: "linear-gradient(90deg, var(--accent), var(--cyan))",
                }}
                className="h-full"
              />
            </div>
            <div className="text-(--text-secondary) text-xs mt-2">{c.copied_count} copiadas</div>
          </a>
        );
      })}
    </div>
  );
}
