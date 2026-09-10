"use client";

import { useState, useTransition } from "react";
import type { MessageInput } from "@/lib/social-proof/types";
import type { AiAssistAction, AiAssistResult } from "@/lib/composer/types";
import type { ScheduledMessageStatus } from "@/lib/types/database";
import { revertAiText, toggleDiscarded } from "@/app/dashboard/automations/scheduled/actions";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

const BOTOES_ASSISTENTE: Array<{ acao: AiAssistAction; label: string }> = [
  { acao: "rewrite", label: "Reescrever este post" },
  { acao: "caption", label: "Criar texto para a imagem" },
  { acao: "summarize", label: "Resumir" },
];

/**
 * Campos que só a campanha agendada tem: cadência de disparo, modo
 * silencioso, o que a IA (Plano 3) mexeu — comparação com o texto original e
 * o motivo de um descarte —, os três botões de assistente sob demanda
 * (reescrever, legendar, resumir), e o detalhe técnico de um envio que
 * falhou.
 *
 * `status`/`errorMessage` vêm da linha REAL (`mtproto_scheduled_messages`),
 * não de `MessageInput` — que não os carrega (ver lib/composer/types.ts).
 * `campaign-composer.tsx` os passa a partir do mapa `porId` que já monta
 * pra `StatusBadge`.
 */
export function CampaignExtras({
  value,
  onChange,
  campaignId,
  status = null,
  errorMessage = null,
  onAssist,
}: {
  value: MessageInput;
  onChange: (v: MessageInput) => void;
  campaignId: string;
  status?: ScheduledMessageStatus | null;
  errorMessage?: string | null;
  /** Ausente = o Plano 3 (assistente de IA) não está ligado — nenhum botão aparece. */
  onAssist?: (id: string, action: AiAssistAction) => Promise<AiAssistResult>;
}) {
  const [mostrarOriginal, setMostrarOriginal] = useState(false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function assistir(acao: AiAssistAction) {
    const id = value.id;
    if (!id || !onAssist) return;
    setErro(null);
    start(async () => {
      const r = await onAssist(id, acao);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      onChange({
        ...value,
        content_text: r.text,
        // Mesma regra "uma vez só" do worker: se o cliente ainda não tinha
        // um original guardado, este É o original — não sobrescreve num
        // segundo tratamento.
        content_text_original: value.content_text_original ?? value.content_text,
      });
    });
  }

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

      {onAssist && value.id && (
        <div className="space-y-2">
          <p className="text-xs text-(--text-muted)">Assistente</p>
          <div className="flex flex-wrap gap-2">
            {BOTOES_ASSISTENTE.map((b) => {
              // "Criar texto para a imagem" só faz sentido com mídia — sem
              // ela não há o que a IA descreva.
              const semMidia = b.acao === "caption" && value.media.length === 0;
              const desabilitado = pending || semMidia;
              return (
                <button
                  key={b.acao}
                  type="button"
                  disabled={desabilitado}
                  title={semMidia ? "Adicione uma mídia antes de gerar a legenda." : undefined}
                  onClick={() => assistir(b.acao)}
                  className="rounded-lg border border-(--border-default) px-3 py-1.5 text-xs text-(--text-secondary) hover:text-(--text-primary) hover:border-(--accent) disabled:opacity-50 transition-colors"
                >
                  {b.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-(--text-muted)">
            O texto original fica salvo — dá pra reverter a qualquer momento.
          </p>
        </div>
      )}

      {status === "failed" && errorMessage && (
        <div className="space-y-1 rounded-lg border border-(--red)/30 bg-(--red-muted) p-3">
          <p className="text-xs font-medium text-(--red)">Detalhe técnico do envio</p>
          <p className="text-xs text-(--text-secondary) whitespace-pre-wrap break-words">
            {errorMessage}
          </p>
          <p className="text-[11px] text-(--text-muted)">
            Texto cru guardado pelo worker — útil pra suporte, não aparece no aviso normal.
          </p>
        </div>
      )}

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
