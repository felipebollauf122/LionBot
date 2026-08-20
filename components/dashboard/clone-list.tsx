const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  running: { label: "RODANDO", badge: "badge-info" },
  waiting_flood: { label: "ESPERANDO", badge: "badge-info" },
  paused: { label: "PAUSADO", badge: "badge-pending" },
  completed: { label: "CONCLUÍDO", badge: "badge-active" },
  failed: { label: "FALHOU", badge: "badge-error" },
  draft: { label: "RASCUNHO", badge: "badge-inactive" },
};

// Renderiza SÓ as linhas — a page envolve num CardShell (o painel é o card).
// Padrão de linha igual ao TopList/ActivityFeed do dashboard: fundo leve dentro
// do painel sólido, row-hover e reveal escalonado.
export function CloneList({
  clones,
  readOnly = false,
}: {
  clones: Array<{
    id: string;
    dest_title: string;
    source_title: string | null;
    status: string;
    copied_count: number;
    total_seen: number;
  }>;
  readOnly?: boolean;
}) {
  if (clones.length === 0) {
    return (
      <div className="py-8 text-center text-(--text-ghost) text-xs">
        Nenhum clone ainda — abra &quot;Ver conteúdo&quot; numa conta e clique em Clonar.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {clones.map((c, i) => {
        const meta = STATUS_MAP[c.status] ?? { label: c.status.toUpperCase(), badge: "badge-inactive" };
        const pct =
          c.total_seen > 0
            ? Math.min(100, Math.round((c.copied_count / c.total_seen) * 100))
            : c.status === "completed"
              ? 100
              : 0;
        // readOnly (visão admin de outro usuário): a página de detalhe usa a
        // sessão do admin pra achar o clone, então linkar daria 404 — vira <div>.
        const rowClass = `row-hover reveal-${Math.min(i + 1, 8)} block px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) ${readOnly ? "" : "hover:border-(--border-default) transition-colors"}`;
        const content = (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground font-medium truncate">{c.dest_title}</span>
              <span className={`badge ${meta.badge} shrink-0`}>{meta.label}</span>
            </div>
            <div className="text-[11px] text-(--text-ghost) truncate mt-0.5">
              de {c.source_title ?? "—"}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, var(--accent), var(--cyan))",
                    transition: "width 1s cubic-bezier(0.16,1,0.3,1)",
                  }}
                />
              </div>
              <span className="text-[11px] font-bold stat-value text-(--text-secondary) shrink-0">
                {c.copied_count} copiadas
              </span>
            </div>
          </>
        );
        return readOnly ? (
          <div key={c.id} className={rowClass}>
            {content}
          </div>
        ) : (
          <a key={c.id} href={`/dashboard/automations/clones/${c.id}`} className={rowClass}>
            {content}
          </a>
        );
      })}
    </div>
  );
}
