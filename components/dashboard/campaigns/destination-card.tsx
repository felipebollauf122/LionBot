"use client";

import { useEffect, useState, useTransition } from "react";
import {
  ensureBotAccessOnDestination,
  listDestinationDialogs,
  setCampaignDestination,
} from "@/app/dashboard/automations/scheduled/actions";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/**
 * Canal ou supergrupo onde a campanha publica. A lista vem de
 * listDestinationDialogs, que já filtra pra só canal/supergrupo com uma
 * conta conectada como admin — grupo legacy não aceita Api.InputChannel, e
 * oferecer esse destino aqui seria prometer o que o bot nunca cumpre.
 */
export function DestinationCard({
  campaignId,
  currentDialogId,
  currentTitle,
  actingTenantId,
}: {
  campaignId: string;
  currentDialogId: string | null;
  currentTitle: string | null;
  /** Admin agindo "como" outro tenant — repassado direto pra listDestinationDialogs. */
  actingTenantId?: string;
}) {
  const [dialogos, setDialogos] = useState<Array<{
    id: string;
    label: string;
    accountId: string;
  }> | null>(null);
  const [selecionado, setSelecionado] = useState(currentDialogId ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Transition própria: preparar o bot é uma operação independente de trocar
  // o destino (mesmo raciocínio da Task 3 — operações independentes não
  // dividem o mesmo useTransition, senão uma desabilita o controle da outra
  // sem necessidade).
  const [botStatus, setBotStatus] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const [preparando, startPreparar] = useTransition();

  useEffect(() => {
    let cancelado = false;
    listDestinationDialogs(actingTenantId).then((lista) => {
      if (!cancelado) setDialogos(lista);
    });
    return () => {
      cancelado = true;
    };
  }, [actingTenantId]);

  function escolher(dialogId: string) {
    setSelecionado(dialogId);
    setErro(null);
    // Um selo "bot pronto" de um canal anterior não vale mais pro novo canal
    // escolhido — cada destino precisa da própria verificação.
    setBotStatus(null);
    start(async () => {
      const r = await setCampaignDestination(campaignId, dialogId);
      if (!r.ok) setErro(r.error);
    });
  }

  function prepararBot() {
    setBotStatus(null);
    startPreparar(async () => {
      const r = await ensureBotAccessOnDestination(campaignId);
      setBotStatus(r.ok ? { ok: true } : { ok: false, error: r.error });
    });
  }

  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
        Destino
      </h2>

      {currentTitle && (
        <p className="text-sm text-(--text-primary)">
          Publicando em <span className="font-semibold">{currentTitle}</span>
        </p>
      )}

      {dialogos === null ? (
        <p className="text-(--text-muted) text-xs">Carregando canais…</p>
      ) : dialogos.length === 0 ? (
        <p className="text-(--text-muted) text-xs">
          Nenhum canal elegível. O destino precisa ser um canal ou supergrupo
          onde uma das suas contas conectadas seja administradora.
        </p>
      ) : (
        <select
          className={CAMPO}
          value={selecionado}
          disabled={pending}
          onChange={(e) => escolher(e.target.value)}
        >
          <option value="" disabled>
            Selecione um canal…
          </option>
          {dialogos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      )}

      {!currentDialogId && !erro && (
        <p className="text-(--amber) text-xs">
          Escolha o canal de destino antes de publicar a campanha.
        </p>
      )}

      {erro && <p className="text-(--red) text-xs">{erro}</p>}

      {currentDialogId && (
        <div className="space-y-2 border-t border-(--border-subtle) pt-3">
          <button
            type="button"
            onClick={prepararBot}
            disabled={preparando}
            className="w-full rounded-lg border border-(--border-default) bg-(--bg-overlay) py-2 text-xs font-medium text-(--text-secondary) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-50"
          >
            {preparando ? "Preparando o bot…" : "Preparar o bot neste canal"}
          </button>

          {botStatus?.ok === true && (
            <p className="inline-flex items-center gap-1.5 rounded-full border border-(--cyan) px-2.5 py-1 text-xs font-medium text-(--cyan)">
              Bot pronto para publicar
            </p>
          )}

          {/* Erro por inteiro, de propósito: ensureBotAccessOnDestination já
              devolve texto acionável (ex.: o que mudar no BotFather), não uma
              mensagem genérica. */}
          {botStatus?.ok === false && (
            <p className="text-(--red) text-xs">{botStatus.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
