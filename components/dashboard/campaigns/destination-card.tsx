"use client";

import { useEffect, useState, useTransition } from "react";
import {
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
    start(async () => {
      const r = await setCampaignDestination(campaignId, dialogId);
      if (!r.ok) setErro(r.error);
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
    </section>
  );
}
