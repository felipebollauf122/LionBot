"use client";

import { useState, useTransition } from "react";
import { accumulateSchedule } from "@/lib/composer/schedule";
import {
  launchScheduledCampaign,
  pauseScheduledCampaign,
  setCampaignSchedule,
} from "@/app/dashboard/automations/scheduled/actions";
import type { ScheduledCampaignStatus, ScheduledMessage } from "@/lib/types/database";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/** `startAt` (ISO ou null) pro valor de um <input type="datetime-local">,
 *  ajustando o fuso — sem isto o campo mostraria o horário em UTC. */
function paraDatetimeLocal(iso: string | null): string {
  const base = iso ? new Date(iso) : new Date(Date.now() + 5 * 60 * 1000);
  const local = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/**
 * Início do disparo, intervalo padrão entre mensagens e o resumo calculado
 * ("N mensagens, última cai em…") — sempre pela MESMA accumulateSchedule que
 * o worker usa pra agendar de verdade, nunca uma soma feita à mão aqui.
 */
export function ScheduleCard({
  campaignId,
  status,
  startAt,
  defaultDelaySeconds,
  hasDestination,
  messages,
  importIncomplete = false,
}: {
  campaignId: string;
  status: ScheduledCampaignStatus;
  startAt: string | null;
  defaultDelaySeconds: number;
  hasDestination: boolean;
  messages: Array<Pick<ScheduledMessage, "id" | "delay_seconds" | "ai_discarded" | "status">>;
  importIncomplete?: boolean;
}) {
  const [inicio, setInicio] = useState(() => paraDatetimeLocal(startAt));
  const [delayMin, setDelayMin] = useState(Math.round(defaultDelaySeconds / 60));
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A fila desta tela tem que ser a MESMA que launchScheduledCampaign vai
  // agendar, e lá o filtro é `status='pending'`. `accumulateSchedule` só
  // descarta `ai_discarded` — ela não conhece status —, então sem este filtro
  // as já enviadas continuavam contadas: numa campanha retomada o card dizia
  // "12 mensagens na fila" com 3 pendentes de verdade, projetava uma "última
  // postagem" lá na frente, e — o pior — numa campanha já concluída
  // (tudo 'sent') deixava o botão ATIVO, porque agenda.length > 0. O clique
  // ia até o servidor só pra voltar com "Não há nenhuma mensagem pendente pra
  // publicar": um botão que aceita o clique pra devolver erro, exatamente o
  // que o comentário de `motivoDesabilitado` diz que não pode existir.
  const pendentes = messages.filter((m) => m.status === "pending");

  const dataInicio = new Date(inicio);
  const agenda = Number.isNaN(dataInicio.getTime())
    ? []
    : accumulateSchedule(
        pendentes.map((m) => ({
          id: m.id,
          delay_seconds: m.delay_seconds,
          ai_discarded: m.ai_discarded,
        })),
        dataInicio,
      );
  const ultima = agenda.at(-1)?.scheduledAt ?? null;

  const jaRodando = status === "running";
  // Publicar no meio do tratamento por IA rebaixava a campanha pra 'draft'
  // quando o worker terminasse — e o poller, que só enfileira
  // status='running', parava a sequência sem erro nenhum. A action recusa
  // por conta própria (a tela não é a única porta), mas um botão que aceita
  // o clique pra devolver erro é pior que um botão que explica.
  const emTratamentoIa = status === "ai_processing";
  const motivoDesabilitado = importIncomplete
    ? "Conclua a importação do clone antes de publicar."
    : !hasDestination
    ? "Escolha o canal de destino antes de publicar."
    : emTratamentoIa
      ? "A IA ainda está tratando esta campanha. Espere ela terminar pra publicar."
      : agenda.length === 0
        ? "Não há mensagens pendentes para publicar."
        : jaRodando
          ? "Esta campanha já está publicando."
          : null;

  function salvarAgenda() {
    if (Number.isNaN(dataInicio.getTime())) return;
    setErro(null);
    start(async () => {
      const r = await setCampaignSchedule(campaignId, {
        startAt: dataInicio.toISOString(),
        defaultDelaySeconds: delayMin * 60,
      });
      if (!r.ok) setErro(r.error);
    });
  }

  function publicar() {
    setErro(null);
    start(async () => {
      const r = await launchScheduledCampaign(campaignId, dataInicio.toISOString());
      if (!r.ok) setErro(r.error);
    });
  }

  function pausar() {
    setErro(null);
    start(async () => {
      const r = await pauseScheduledCampaign(campaignId);
      if (!r.ok) setErro(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
        Agendamento
      </h2>

      <label className="block space-y-1 text-xs text-(--text-ghost)">
        Início
        <input
          type="datetime-local"
          className={CAMPO}
          value={inicio}
          disabled={pending || jaRodando}
          onChange={(e) => setInicio(e.target.value)}
          onBlur={salvarAgenda}
        />
      </label>

      <label className="block space-y-1 text-xs text-(--text-ghost)">
        Espaçamento padrão entre mensagens (minutos)
        <input
          type="number"
          min={0}
          className={CAMPO}
          value={delayMin}
          disabled={pending || jaRodando}
          onChange={(e) => setDelayMin(Math.max(0, Number(e.target.value) || 0))}
          onBlur={salvarAgenda}
        />
      </label>

      <div className="rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-xs text-(--text-secondary)">
        {agenda.length === 0 ? (
          <p>Nenhuma mensagem pendente para publicar.</p>
        ) : (
          <>
            <p>{agenda.length} mensagem(ns) na fila.</p>
            <p>
              Última postagem cai em{" "}
              <span className="text-(--text-primary) font-medium">
                {ultima?.toLocaleString("pt-BR") ?? "—"}
              </span>
              .
            </p>
          </>
        )}
      </div>

      {erro && <p className="text-(--red) text-xs">{erro}</p>}
      {!jaRodando && motivoDesabilitado && <p className="text-sm text-(--text-secondary)">{motivoDesabilitado}</p>}

      {jaRodando ? (
        <button
          type="button"
          onClick={pausar}
          disabled={pending}
          className="w-full rounded-lg border border-(--border-default) bg-(--bg-overlay) py-2.5 text-sm font-medium text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-50 transition-colors"
        >
          Pausar campanha
        </button>
      ) : (
        <button
          type="button"
          onClick={publicar}
          disabled={pending || motivoDesabilitado !== null}
          title={motivoDesabilitado ?? undefined}
          className="w-full rounded-lg bg-(--accent) py-2.5 text-sm font-semibold text-(--on-accent) disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          Publicar campanha
        </button>
      )}
    </section>
  );
}
