"use client";

import { useEffect, useState, useTransition } from "react";
import {
  launchBotCloneJob,
  pauseBotCloneJob,
  resumeBotCloneJob,
  deleteBotCloneJob,
  listBotCloneSkipReport,
} from "@/app/dashboard/automations/botclones/actions";

type Job = {
  id: string;
  status: string;
  target_bot_username: string;
  nodes_discovered: number;
  nodes_skipped: number;
  messages_captured: number;
  remarketing_messages_captured: number;
  suspected_payment_hit: boolean;
  last_error: string | null;
  dest_flow_id: string | null;
  dest_bot_id: string;
  dest_remarketing_config_id: string | null;
};

// Mapa canônico de status (mesma palavra = mesma cor do resto do console).
const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: "RASCUNHO", badge: "badge-inactive" },
  exploring: { label: "EXPLORANDO", badge: "badge-info" },
  waiting_flood: { label: "ESPERANDO", badge: "badge-info" },
  listening_remarketing: { label: "LENDO REMARKETING", badge: "badge-purple" },
  building_flow: { label: "MONTANDO FLUXO", badge: "badge-info" },
  completed: { label: "CONCLUÍDO", badge: "badge-active" },
  failed: { label: "FALHOU", badge: "badge-error" },
  paused: { label: "PAUSADO", badge: "badge-pending" },
};

const LIVE = new Set(["exploring", "waiting_flood", "listening_remarketing", "building_flow"]);

export function BotCloneProgress({ initial }: { initial: Job }) {
  const [job, setJob] = useState(initial);
  const [report, setReport] = useState<Array<{ reason: string; count: number }>>([]);
  const [pending, start] = useTransition();
  // Erro de pausar/retomar/apagar: as Server Actions lançam (throw) em vez de
  // devolver { ok, error }, então precisamos capturar e mostrar.
  const [actionError, setActionError] = useState<string | null>(null);

  // Polling de 3s, mesmo padrão do clone de canal.
  useEffect(() => {
    if (!LIVE.has(job.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/botclones/${job.id}`, { cache: "no-store" });
      if (res.ok) setJob(await res.json());
    }, 3000);
    return () => clearInterval(t);
  }, [job.id, job.status]);

  useEffect(() => {
    listBotCloneSkipReport(job.id).then(setReport);
  }, [job.id, job.nodes_discovered]);

  // Roda uma ação de mudança de status e já atualiza o `status` local pro
  // valor esperado — sem isso, o polling (useEffect acima, que só liga
  // quando LIVE.has(job.status)) fica preso olhando pro status ANTIGO até o
  // próximo fetch manual, porque as Server Actions abaixo não devolvem o job
  // atualizado. Otimista: se a action falhar, actionError aparece e o próximo
  // poll (se LIVE ligou) ou reload corrige sozinho.
  function runAction(action: () => Promise<void>, optimisticStatus: string) {
    start(async () => {
      setActionError(null);
      try {
        await action();
        setJob((prev) => ({ ...prev, status: optimisticStatus }));
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const statusMeta =
    STATUS_MAP[job.status] ?? { label: job.status.toUpperCase(), badge: "badge-inactive" };

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="flex items-center justify-between gap-3">
        <span className={`badge ${statusMeta.badge} shrink-0`}>{statusMeta.label}</span>
        <span className="text-(--text-muted) text-xs text-right truncate">
          @{job.target_bot_username}
        </span>
      </div>

      {/* Suspeita de confirmação de pagamento — não pausou, só marcou */}
      {job.suspected_payment_hit && (
        <div
          className="rounded-xl p-3 border border-(--amber)/25 flex items-start gap-2.5"
          style={{ background: "color-mix(in srgb, var(--amber) 10%, transparent)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--amber)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 mt-0.5"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-(--amber) text-xs leading-relaxed">
            O EagleBot suspeitou de uma confirmação de pagamento em algum ponto da exploração — a
            exploração <b>não parou</b>, continuou normalmente. Revise os nós marcados abaixo antes
            de ativar este fluxo.
          </p>
        </div>
      )}

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-2">
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <p className="stat-value text-xl text-foreground">{job.nodes_discovered}</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">nós descobertos</p>
        </div>
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <p className="stat-value text-xl text-(--text-secondary)">{job.nodes_skipped}</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">pulados</p>
        </div>
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <p className="stat-value text-xl text-(--text-secondary)">{job.messages_captured}</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">mensagens</p>
        </div>
      </div>

      {/* Leitura do histórico de remarketing — passo rápido (lê o que já existe
          na conta exploradora, não espera mensagem nova chegar ao vivo). */}
      {(job.status === "listening_remarketing" || job.remarketing_messages_captured > 0) && (
        <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <div className="flex items-center justify-between gap-3">
            <span className="text-(--text-secondary) text-xs">
              {job.status === "listening_remarketing" ? "Lendo histórico de remarketing..." : "Remarketing capturado"}
            </span>
            <span className="stat-value text-xs text-(--text-secondary)">
              {job.remarketing_messages_captured} mensagens
            </span>
          </div>
        </div>
      )}

      {job.last_error && <p className="text-(--red) text-xs">{job.last_error}</p>}

      {job.dest_flow_id && (
        <a
          href={`/dashboard/bots/${job.dest_bot_id}/flows/${job.dest_flow_id}/editor`}
          className="btn-ghost text-xs px-3 py-1.5 w-full text-center"
        >
          Abrir o fluxo clonado →
        </a>
      )}

      {job.dest_remarketing_config_id && (
        <p className="text-(--text-muted) text-xs">
          Mensagens de remarketing também foram clonadas — revise no painel de remarketing do bot.
        </p>
      )}

      <div className="flex gap-2">
        {job.status === "exploring" || job.status === "waiting_flood" ? (
          <button
            onClick={() => runAction(() => pauseBotCloneJob(job.id), "paused")}
            disabled={pending}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            Pausar
          </button>
        ) : job.status === "paused" || job.status === "failed" ? (
          <button
            onClick={() => runAction(() => resumeBotCloneJob(job.id), "exploring")}
            disabled={pending}
            className="btn-primary text-xs px-3 py-1.5"
          >
            {job.status === "failed" ? "Tentar de novo" : "Retomar"}
          </button>
        ) : job.status === "draft" ? (
          // launchBotCloneJob normalmente é disparado pelo form logo após
          // criar o job — este botão só existe pro caso raro em que aquele
          // primeiro lançamento falhou (ex.: bot-server fora do ar por um
          // instante) e o job ficou parado em 'draft', sem nenhuma outra
          // forma de tentar de novo a não ser apagar e refazer o formulário.
          <button
            onClick={() => runAction(() => launchBotCloneJob(job.id), "exploring")}
            disabled={pending}
            className="btn-primary text-xs px-3 py-1.5"
          >
            Lançar
          </button>
        ) : null}
        <button
          onClick={() =>
            start(async () => {
              setActionError(null);
              try {
                await deleteBotCloneJob(job.id);
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
