"use client";

import { useState, useTransition } from "react";
import type { MessageInput } from "@/lib/social-proof/types";
import { revertAiText, toggleDiscarded } from "@/app/dashboard/automations/scheduled/actions";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/**
 * Campos que só a campanha agendada tem: cadência de disparo, modo
 * silencioso, e o que a IA (Plano 3) mexeu — comparação com o texto
 * original e o motivo de um descarte. Os três botões de assistente
 * (reescrever, legendar, resumir) ficam de fora — o Plano 3 os acrescenta
 * aqui.
 */
export function CampaignExtras({
  value,
  onChange,
  campaignId,
}: {
  value: MessageInput;
  onChange: (v: MessageInput) => void;
  campaignId: string;
}) {
  const [mostrarOriginal, setMostrarOriginal] = useState(false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function reverter() {
    const id = value.id;
    if (!id) return;
    setErro(null);
    start(async () => {
      const r = await revertAiText(id, campaignId);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      onChange({
        ...value,
        content_text: value.content_text_original ?? value.content_text,
        content_text_original: null,
      });
      setMostrarOriginal(false);
    });
  }

  function restaurar() {
    const id = value.id;
    if (!id) return;
    setErro(null);
    start(async () => {
      const r = await toggleDiscarded(id, campaignId, false);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      onChange({ ...value, ai_discarded: false });
    });
  }

  const temTextoOriginal =
    value.content_text_original !== null && value.content_text_original !== undefined;

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Envio</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-(--text-ghost)">
            Espera antes desta mensagem (min)
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={Math.round((value.delay_seconds ?? 900) / 60)}
              onChange={(e) =>
                onChange({
                  ...value,
                  delay_seconds: Math.max(0, Number(e.target.value) || 0) * 60,
                })
              }
            />
          </label>
          <label className="flex items-center gap-2 pt-5 text-xs text-(--text-secondary)">
            <input
              type="checkbox"
              checked={value.silent ?? true}
              onChange={(e) => onChange({ ...value, silent: e.target.checked })}
              className="h-4 w-4 rounded border-(--border-default) accent-(--accent)"
            />
            Silencioso
          </label>
        </div>
        <p className="text-xs text-(--text-ghost)">
          Publica sem tocar a notificação dos inscritos.
        </p>
      </div>

      {temTextoOriginal && (
        <div className="space-y-2 rounded-lg border border-(--border-default) p-3">
          <p className="text-xs text-(--text-muted)">Texto ajustado pela IA</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMostrarOriginal(false)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                !mostrarOriginal
                  ? "bg-(--accent) text-(--on-accent)"
                  : "border border-(--border-default) text-(--text-secondary)"
              }`}
            >
              IA
            </button>
            <button
              type="button"
              onClick={() => setMostrarOriginal(true)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                mostrarOriginal
                  ? "bg-(--accent) text-(--on-accent)"
                  : "border border-(--border-default) text-(--text-secondary)"
              }`}
            >
              Original
            </button>
          </div>
          <p className="rounded-md bg-(--bg-input) px-3 py-2 text-xs text-(--text-secondary) whitespace-pre-wrap">
            {(mostrarOriginal ? value.content_text_original : value.content_text) || "(vazio)"}
          </p>
          <button
            type="button"
            onClick={reverter}
            disabled={pending || !value.id}
            title={!value.id ? "Salve a mensagem antes de reverter." : undefined}
            className="w-full rounded-md border border-(--border-default) py-1.5 text-xs font-medium text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:opacity-50 transition-colors"
          >
            Reverter para o texto original
          </button>
        </div>
      )}

      {value.ai_discarded && (
        <div className="space-y-2 rounded-lg border border-(--amber)/30 bg-(--amber-muted) p-3">
          <p className="text-xs font-medium text-(--amber)">Descartada pela IA</p>
          {value.ai_reason && (
            <p className="text-xs text-(--text-secondary)">{value.ai_reason}</p>
          )}
          <button
            type="button"
            onClick={restaurar}
            disabled={pending || !value.id}
            title={!value.id ? "Salve a mensagem antes de restaurar." : undefined}
            className="w-full rounded-md border border-(--amber)/40 py-1.5 text-xs font-medium text-(--amber) hover:bg-(--amber)/10 disabled:opacity-50 transition-colors"
          >
            Restaurar mensagem
          </button>
        </div>
      )}

      {erro && <p className="text-(--red) text-xs">{erro}</p>}
    </>
  );
}
