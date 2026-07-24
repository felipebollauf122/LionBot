"use client";

import { useEffect, useState, useTransition } from "react";
import {
  pauseClone,
  launchClone,
  deleteClone,
  listCloneSkipReport,
} from "@/app/dashboard/automations/clones/actions";
import { friendlyCloneError } from "@/lib/mtproto/clone-errors";

type Job = {
  id: string;
  status: string;
  effective_strategy: string | null;
  dest_invite_link: string | null;
  total_seen: number;
  copied_count: number;
  skipped_count: number;
  failed_count: number;
  message_limit: number | null;
  last_error: string | null;
};

const STRATEGY_LABEL: Record<string, string> = {
  batch: "encaminhamento em lote (rápido)",
  download: "baixar e reenviar (a origem protege o conteúdo)",
};

// Mapa canônico de status (mesma palavra = mesma cor do resto do console).
const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  running: { label: "RODANDO", badge: "badge-info" },
  waiting_flood: { label: "ESPERANDO", badge: "badge-info" },
  paused: { label: "PAUSADO", badge: "badge-pending" },
  completed: { label: "CONCLUÍDO", badge: "badge-active" },
  failed: { label: "FALHOU", badge: "badge-error" },
  draft: { label: "RASCUNHO", badge: "badge-inactive" },
  scheduled: { label: "AGENDADO", badge: "badge-purple" },
};

const LIVE = new Set(["running", "waiting_flood"]);

export function CloneProgress({ initial }: { initial: Job }) {
  const [job, setJob] = useState(initial);
  const [report, setReport] = useState<Array<{ reason: string; count: number }>>([]);
  const [pending, start] = useTransition();
  // Erro de pausar/retomar/apagar: as Server Actions lancam (throw) em vez de
  // devolver { ok, error }, entao precisamos capturar e mostrar pro usuario.
  const [actionError, setActionError] = useState<string | null>(null);

  // Polling de 3s, mesmo padrão das campanhas.
  useEffect(() => {
    if (!LIVE.has(job.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/clones/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 3000);
    return () => clearInterval(t);
  }, [job.id, job.status]);

  useEffect(() => {
    listCloneSkipReport(job.id).then(setReport);
  }, [job.id, job.copied_count]);

  const total = job.message_limit ?? Math.max(job.total_seen, 1);
  const pct = Math.min(100, Math.round((job.total_seen / total) * 100));

  const statusMeta =
    STATUS_MAP[job.status] ?? { label: job.status.toUpperCase(), badge: "badge-inactive" };

  return (
    <div className="space-y-5">
      {/* Status + estratégia + barra de progresso */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className={`badge ${statusMeta.badge} shrink-0`}>{statusMeta.label}</span>
          <span className="text-(--text-muted) text-xs text-right">
            {job.effective_strategy ? STRATEGY_LABEL[job.effective_strategy] : "decidindo rota..."}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--accent), var(--cyan))",
              transition: "width 1s cubic-bezier(0.16,1,0.3,1)",
            }}
          />
        </div>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-2">
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <p className="stat-value text-xl text-foreground">{job.copied_count}</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">copiadas</p>
        </div>
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <p className="stat-value text-xl text-(--text-secondary)">{job.skipped_count}</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">puladas</p>
        </div>
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <p className="stat-value text-xl text-(--red)">{job.failed_count}</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">falhas</p>
        </div>
      </div>

      {job.last_error && (
        <p className="text-(--red) text-xs">{friendlyCloneError(job.last_error)}</p>
      )}

      {job.dest_invite_link && (
        <a
          href={job.dest_invite_link}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-xs px-3 py-1.5 w-full"
        >
          Abrir o canal clonado →
        </a>
      )}

      <div className="flex gap-2">
        {LIVE.has(job.status) ? (
          <button
            onClick={() =>
              start(async () => {
                setActionError(null);
                try {
                  await pauseClone(job.id);
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : String(err));
                }
              })
            }
            disabled={pending}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            Pausar
          </button>
        ) : (
          job.status !== "completed" && (
            <button
              onClick={() =>
                start(async () => {
                  setActionError(null);
                  try {
                    await launchClone(job.id);
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : String(err));
                  }
                })
              }
              disabled={pending}
              className="btn-primary text-xs px-3 py-1.5"
            >
              Retomar
            </button>
          )
        )}
        <button
          onClick={() =>
            start(async () => {
              setActionError(null);
              try {
                await deleteClone(job.id);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              }
            })
          }
          disabled={pending}
          className="btn-danger text-xs px-3 py-1.5"
        >
          Apagar
        </button>
      </div>
      {actionError && <p className="text-(--red) text-xs">{actionError}</p>}

      {report.length > 0 && (
        <div>
          <h3 className="text-foreground text-sm font-medium mb-2">O que não foi clonado</h3>
          <div className="space-y-1.5">
            {report.map((r) => (
              <div
                key={r.reason}
                className="row-hover flex items-center justify-between gap-3 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
              >
                <span className="text-(--text-secondary) text-xs">{r.reason}</span>
                <span className="text-(--text-muted) text-xs stat-value">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
