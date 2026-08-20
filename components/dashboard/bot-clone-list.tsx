const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: "RASCUNHO", badge: "badge-inactive" },
  exploring: { label: "EXPLORANDO", badge: "badge-info" },
  waiting_flood: { label: "ESPERANDO", badge: "badge-info" },
  listening_remarketing: { label: "OUVINDO REMARKETING", badge: "badge-purple" },
  building_flow: { label: "MONTANDO FLUXO", badge: "badge-info" },
  completed: { label: "CONCLUÍDO", badge: "badge-active" },
  failed: { label: "FALHOU", badge: "badge-error" },
  paused: { label: "PAUSADO", badge: "badge-pending" },
};

// Renderiza SÓ as linhas — a page envolve num CardShell (o painel é o card).
// Sem barra de progresso: não existe um "total" fixo pra clonagem de bot (a
// árvore de nós cresce até bater max_nodes ou esgotar os botões), então uma
// barra de % seria inventada. Mostra a contagem crua, honesta.
export function BotCloneList({
  clones,
}: {
  clones: Array<{
    id: string;
    target_bot_username: string;
    status: string;
    nodes_discovered: number;
  }>;
}) {
  if (clones.length === 0) {
    return (
      <div className="py-8 text-center text-(--text-ghost) text-xs">
        Nenhuma clonagem de bot ainda — clique em &quot;Novo&quot; e informe o @username do bot-alvo.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {clones.map((c, i) => {
        const meta = STATUS_MAP[c.status] ?? { label: c.status.toUpperCase(), badge: "badge-inactive" };
        return (
          <a
            key={c.id}
            href={`/dashboard/automations/botclones/${c.id}`}
            className={`row-hover reveal-${Math.min(i + 1, 8)} block px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) hover:border-(--border-default) transition-colors`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground font-medium truncate">
                @{c.target_bot_username}
              </span>
              <span className={`badge ${meta.badge} shrink-0`}>{meta.label}</span>
            </div>
            <div className="text-[11px] text-(--text-ghost) mt-1.5">
              {c.nodes_discovered} nó{c.nodes_discovered === 1 ? "" : "s"} descoberto
              {c.nodes_discovered === 1 ? "" : "s"}
            </div>
          </a>
        );
      })}
    </div>
  );
}
