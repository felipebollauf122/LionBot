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
      <p className="text-white/40 text-sm">
        Nenhum clone ainda. Abra &quot;Ver conteúdo&quot; numa conta e clique em Clonar.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {clones.map((c) => (
        <a
          key={c.id}
          href={`/dashboard/automations/clones/${c.id}`}
          className="flex items-center justify-between px-3 py-2 rounded-md border border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
        >
          <div className="min-w-0">
            <div className="text-white text-sm truncate">{c.dest_title}</div>
            <div className="text-white/40 text-xs truncate">de {c.source_title ?? "—"}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-white/70 text-xs">{c.status}</div>
            <div className="text-white/40 text-xs">{c.copied_count} copiadas</div>
          </div>
        </a>
      ))}
    </div>
  );
}
