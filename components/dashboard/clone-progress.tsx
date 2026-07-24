"use client";

import { useEffect, useState, useTransition } from "react";
import {
  pauseClone,
  launchClone,
  deleteClone,
  listCloneSkipReport,
} from "@/app/dashboard/automations/clones/actions";

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

const LIVE = new Set(["running", "waiting_flood"]);

export function CloneProgress({ initial }: { initial: Job }) {
  const [job, setJob] = useState(initial);
  const [report, setReport] = useState<Array<{ reason: string; count: number }>>([]);
  const [pending, start] = useTransition();

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

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white text-sm">{job.status}</span>
          <span className="text-white/40 text-xs">
            {job.effective_strategy ? STRATEGY_LABEL[job.effective_strategy] : "decidindo rota..."}
          </span>
        </div>
        <div className="h-2 rounded bg-white/10 overflow-hidden">
          <div className="h-full bg-(--accent)" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-4 mt-3 text-xs">
          <span className="text-white/70">{job.copied_count} copiadas</span>
          <span className="text-white/40">{job.skipped_count} puladas</span>
          <span className="text-red-400/70">{job.failed_count} falhas</span>
        </div>
        {job.last_error && <p className="text-red-400 text-xs mt-2">{job.last_error}</p>}
      </div>

      {job.dest_invite_link && (
        <a
          href={job.dest_invite_link}
          target="_blank"
          rel="noreferrer"
          className="block text-(--accent) text-sm hover:underline"
        >
          Abrir o canal clonado →
        </a>
      )}

      <div className="flex gap-2">
        {LIVE.has(job.status) ? (
          <button
            onClick={() => start(() => void pauseClone(job.id))}
            disabled={pending}
            className="px-3 py-1.5 rounded border border-white/15 text-white/80 text-sm"
          >
            Pausar
          </button>
        ) : (
          job.status !== "completed" && (
            <button
              onClick={() => start(() => void launchClone(job.id))}
              disabled={pending}
              className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm"
            >
              Retomar
            </button>
          )
        )}
        <button
          onClick={() => start(() => void deleteClone(job.id))}
          disabled={pending}
          className="px-3 py-1.5 text-white/40 hover:text-red-400 text-sm"
        >
          Apagar
        </button>
      </div>

      {report.length > 0 && (
        <div>
          <h3 className="text-white text-sm font-medium mb-2">O que não foi clonado</h3>
          <div className="space-y-1">
            {report.map((r) => (
              <div
                key={r.reason}
                className="flex justify-between px-3 py-2 rounded border border-white/10 text-xs"
              >
                <span className="text-white/70">{r.reason}</span>
                <span className="text-white/40">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
