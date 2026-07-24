"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCampaign } from "@/app/dashboard/automations/actions";

interface Campaign {
  id: string;
  name: string;
  status: string;
  total_targets: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  recurrence_hours?: number | null;
  next_run_at?: string | null;
}

function formatNextRun(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return "agora";
  const hours = Math.floor(diffMs / 3600_000);
  if (hours < 1) {
    const mins = Math.max(1, Math.round(diffMs / 60_000));
    return `em ${mins} min`;
  }
  if (hours < 24) return `em ${hours}h`;
  const days = Math.floor(hours / 24);
  return `em ${days}d`;
}

// Mapa de status → cor de badge alinhado com o STATUS_MAP de clone-list.tsx:
// a mesma palavra de status tem a mesma cor na página (running=cyan/info,
// completed=magenta/active, paused=âmbar/pending, failed=vermelho, draft=cinza).
// scheduled é exclusivo de campanha (roxo, "futuro").
function campaignBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case "running":
      return { cls: "badge-info", label: "Ativa" };
    case "scheduled":
      return { cls: "badge-purple", label: "Agendada" };
    case "pending":
      return { cls: "badge-pending", label: "Pendente" };
    case "completed":
      return { cls: "badge-active", label: "Concluída" };
    case "paused":
      return { cls: "badge-pending", label: "Pausada" };
    case "draft":
      return { cls: "badge-inactive", label: "Rascunho" };
    case "failed":
      return { cls: "badge-error", label: "Falhou" };
    default:
      return { cls: "badge-inactive", label: status };
  }
}

export function MtprotoCampaignList({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (campaigns.length === 0) {
    return (
      <div className="card p-4">
        <p className="text-(--text-muted) text-sm">Nenhuma campanha ainda.</p>
      </div>
    );
  }

  function handleDelete(e: React.MouseEvent, c: Campaign) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Excluir a campanha "${c.name}"? Esta ação não pode ser desfeita.`)) return;
    setPendingId(c.id);
    startTransition(async () => {
      try {
        await deleteCampaign(c.id);
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "erro ao excluir");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      {campaigns.map((c, i) => {
        const isRecurrent = !!c.recurrence_hours;
        const nextRun = formatNextRun(c.next_run_at);
        const deleting = pendingId === c.id;
        const badge = campaignBadge(c.status);
        const pct =
          c.total_targets > 0
            ? Math.min(100, Math.round((c.sent_count / c.total_targets) * 100))
            : 0;
        return (
          <div
            key={c.id}
            className={`card-interactive p-4 flex items-center gap-3 reveal-${Math.min(i + 1, 8)} ${deleting ? "opacity-50" : ""}`}
          >
            <a
              href={`/dashboard/automations/campaigns/${c.id}`}
              className="flex-1 flex items-center justify-between gap-3 min-w-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-(--text-primary) text-sm font-semibold flex items-center gap-2">
                  {isRecurrent && (
                    <span title={`Recorrente a cada ${c.recurrence_hours}h`}>🔁</span>
                  )}
                  <span className="truncate">{c.name}</span>
                  <span className={`badge ${badge.cls} shrink-0`}>{badge.label}</span>
                </div>
                <div className="text-(--text-muted) text-xs mt-1.5">
                  {c.sent_count}/{c.total_targets} enviadas
                  {" · "}
                  <span className={c.failed_count > 0 ? "text-(--red)" : ""}>
                    {c.failed_count} falhas
                  </span>
                  {isRecurrent && (
                    <>
                      {" · "}
                      a cada {c.recurrence_hours}h
                      {nextRun && c.status === "scheduled" ? ` · próxima ${nextRun}` : ""}
                    </>
                  )}
                </div>
                {c.total_targets > 0 && (
                  <div className="mt-2 h-2 rounded-full bg-(--bg-input) overflow-hidden max-w-xs">
                    <div
                      style={{
                        width: `${pct}%`,
                        background: "linear-gradient(90deg, var(--accent), var(--cyan))",
                      }}
                      className="h-full"
                    />
                  </div>
                )}
              </div>
              <div className="text-(--text-ghost) text-xs shrink-0 pl-3">
                {new Date(c.created_at).toLocaleDateString("pt-BR")}
              </div>
            </a>
            <button
              type="button"
              onClick={(e) => handleDelete(e, c)}
              disabled={deleting}
              title="Excluir campanha"
              className="btn-danger shrink-0 p-0 w-9 h-9 disabled:opacity-40"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
