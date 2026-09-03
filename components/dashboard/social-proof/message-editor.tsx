"use client";

import type { MessageInput, MessageKind, SenderKind } from "@/lib/social-proof/types";
import { MediaPicker } from "@/components/dashboard/social-proof/media-picker";
import { motion, AnimatePresence } from "motion/react";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

const TIPOS: { kind: MessageKind; label: string }[] = [
  { kind: "text", label: "Texto" },
  { kind: "photo", label: "Foto" },
  { kind: "video", label: "Vídeo" },
  { kind: "audio", label: "Áudio" },
  { kind: "album", label: "Álbum" },
];

/** Paleta fixa. Um seletor completo de emoji é uma dependência inteira pra um
 *  caso em que sete opções cobrem quase tudo. */
const EMOJIS = ["❤️", "🔥", "👏", "😂", "😮", "🙏", "💎"];

const MAX_TEXTO = 1024;

export function MessageEditor({
  value,
  index,
  onChange,
  onSave,
  onDuplicate,
  onReply,
  onPin,
  onDelete,
  saving,
  error,
}: {
  value: MessageInput;
  index: number;
  onChange: (v: MessageInput) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onReply: () => void;
  onPin: () => void;
  onDelete: () => void;
  saving: boolean;
  error: string | null;
}) {
  function setReacao(emoji: string, delta: number) {
    const atual = value.reactions.find((r) => r.emoji === emoji);

    if (atual) {
      const count = Math.max(0, atual.count + delta);
      const novas =
        count === 0
          ? value.reactions.filter((r) => r.emoji !== emoji)
          : value.reactions.map((r) => (r.emoji === emoji ? { ...r, count } : r));
      onChange({ ...value, reactions: novas });
      return;
    }

    // A reação ainda não existe. Só faz sentido criar quando o gesto é de
    // somar — botão direito (delta negativo) num emoji zerado não tem o que
    // subtrair, e criar a reação aí seria o oposto do que o botão promete.
    if (delta <= 0) return;

    onChange({ ...value, reactions: [...value.reactions, { emoji, count: delta }] });
  }

  return (
    <aside className="flex flex-col gap-5 rounded-xl border border-(--border-subtle) p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--text-primary)">
          Editando mensagem #{index + 1}
        </h2>
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="text-(--red) disabled:opacity-50 flex items-center justify-center h-8 w-8 rounded-full hover:bg-(--red)/10 transition-colors"
          aria-label="Excluir"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
        </motion.button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 8 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red) overflow-hidden"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {value.reply_to_id && (
          <motion.div
            initial={{ opacity: 0, height: 0, scale: 0.95 }}
            animate={{ opacity: 1, height: "auto", scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.95 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between rounded-lg bg-(--accent)/10 border border-(--accent)/20 px-3 py-2.5 mb-2">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                <span className="text-sm font-medium text-(--accent)">Respondendo à mensagem</span>
              </div>
              <button 
                onClick={() => onChange({ ...value, reply_to_id: null })}
                className="text-(--text-muted) hover:text-(--red) transition-colors p-1"
                title="Remover resposta"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Enviar como — dois cartões, nunca um select */}
      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Enviar como</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { kind: "owner" as SenderKind, titulo: "admin", sub: "Aparece como admin" },
            { kind: "member" as SenderKind, titulo: "Membro", sub: "Aparece como membro" },
          ]).map((op) => (
            <button
              key={op.kind}
              type="button"
              onClick={() => onChange({ ...value, sender_kind: op.kind })}
              className={`relative rounded-lg border p-3 text-left transition-colors ${
                value.sender_kind === op.kind
                  ? "border-(--accent)/50 text-(--text-primary)"
                  : "border-(--border-default) hover:bg-(--bg-hover) text-(--text-secondary)"
              }`}
            >
              {value.sender_kind === op.kind && (
                <motion.div
                  layoutId="enviarComoAtivo"
                  className="absolute inset-0 rounded-lg bg-(--accent-deep) border-2 border-(--accent) pointer-events-none"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                />
              )}
              <div className="relative z-10">
                <p className={`text-sm font-medium ${value.sender_kind === op.kind ? "text-(--text-primary)" : "text-(--text-primary)"}`}>{op.titulo}</p>
                <p className={`text-xs ${value.sender_kind === op.kind ? "text-(--text-secondary)" : "text-(--text-muted)"}`}>{op.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {value.sender_kind === "member" && (
        <div className="space-y-2">
          <input
            className={CAMPO}
            placeholder="Nome do remetente"
            value={value.sender_name}
            onChange={(e) => onChange({ ...value, sender_name: e.target.value })}
          />
          <input
            className={CAMPO}
            placeholder="URL do avatar do remetente"
            value={value.sender_avatar_url ?? ""}
            onChange={(e) => onChange({ ...value, sender_avatar_url: e.target.value || null })}
          />
        </div>
      )}

      {/* Tipo — botões segmentados, nunca um select */}
      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Tipo de mensagem</p>
        <div className="relative grid grid-cols-5 gap-1 rounded-lg border border-(--border-default) p-1 bg-(--bg-input)">
          {TIPOS.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => {
                const media =
                  t.kind === "album"
                    ? value.media
                    : t.kind === "text"
                      ? []
                      : value.media.filter((m) => m.type === t.kind).slice(0, 1);
                onChange({ ...value, kind: t.kind, media });
              }}
              className={`relative rounded-md py-1.5 text-xs z-10 transition-colors duration-200 ${
                value.kind === t.kind
                  ? "text-(--on-accent) font-medium"
                  : "text-(--text-secondary) hover:text-(--text-primary)"
              }`}
            >
              {value.kind === t.kind && (
                <motion.div
                  layoutId="tipoMensagemAtivo"
                  className="absolute inset-0 rounded-md bg-(--accent) z-[-1]"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                />
              )}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-(--text-muted)">Conteúdo</p>
        <textarea
          className={CAMPO}
          rows={4}
          maxLength={MAX_TEXTO}
          value={value.content_text ?? ""}
          onChange={(e) => onChange({ ...value, content_text: e.target.value })}
        />
        <p className="text-right text-xs text-(--text-ghost)">
          {(value.content_text ?? "").length}/{MAX_TEXTO}
        </p>
      </div>

      {value.kind !== "text" && (
        <div className="space-y-2">
          <p className="text-xs text-(--text-muted)">Mídia</p>
          <MediaPicker
            media={value.media}
            kind={value.kind}
            onChange={(media) => onChange({ ...value, media })}
          />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Metadados</p>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-(--text-ghost)">
            Visualizações
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={value.views_count}
              onChange={(e) =>
                onChange({ ...value, views_count: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label className="text-xs text-(--text-ghost)">
            Há quantos minutos
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={Math.round(value.offset_seconds / 60)}
              onChange={(e) =>
                onChange({
                  ...value,
                  offset_seconds: Math.max(0, Number(e.target.value) || 0) * 60,
                })
              }
            />
          </label>
          <label className="text-xs text-(--text-ghost)">
            Horário (opcional)
            <input
              className={CAMPO}
              placeholder="02:44"
              value={value.display_time ?? ""}
              onChange={(e) => onChange({ ...value, display_time: e.target.value || null })}
            />
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Reações (opcional)</p>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((emoji) => {
            const atual = value.reactions.find((r) => r.emoji === emoji);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => setReacao(emoji, 1)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setReacao(emoji, -1);
                }}
                title="Clique para somar, botão direito para subtrair"
                className={`rounded-full border px-3 py-1 text-sm ${
                  atual
                    ? "border-(--accent) bg-(--accent-deep) text-(--text-primary)"
                    : "border-(--border-default) text-(--text-secondary)"
                }`}
              >
                {emoji} {atual?.count ?? 0}
              </button>
            );
          })}
        </div>
      </div>

      {/* disabled={saving} nos quatro não é estética: é proteção contra ação
          concorrente sobre a MESMA linha. Sem isto, "Excluir" clicado enquanto
          "Salvar mensagem" ainda está em voo pode apagar a linha antes do
          update comitar (a resposta volta "mensagem não encontrada" — confuso,
          já que o tenant não pediu excluir nada); e "Duplicar" nesse intervalo
          pode ler a linha antes do update gravar, duplicando o conteúdo ANTIGO. */}
      <div className="grid grid-cols-2 gap-2 border-t border-(--border-subtle) pt-4">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={onDuplicate}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-overlay) py-2 text-sm font-medium text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) hover:border-(--border-subtle) disabled:opacity-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Duplicar
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={onReply}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-overlay) py-2 text-sm font-medium text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) hover:border-(--border-subtle) disabled:opacity-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          Responder
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={onPin}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-overlay) py-2 text-sm font-medium text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary) hover:border-(--border-subtle) disabled:opacity-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
          Fixar
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-(--red)/30 bg-(--red)/5 py-2 text-sm font-medium text-(--red) hover:bg-(--red)/10 hover:border-(--red)/50 disabled:opacity-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          Excluir
        </motion.button>
      </div>

      <motion.button
        whileHover={{ scale: saving ? 1 : 1.01 }}
        whileTap={{ scale: saving ? 1 : 0.98 }}
        type="button"
        onClick={onSave}
        disabled={saving}
        className="relative flex items-center justify-center overflow-hidden rounded-lg bg-(--accent) py-2.5 text-sm font-semibold text-(--on-accent) disabled:opacity-80 transition-opacity"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {saving ? (
            <motion.div
              key="saving"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="flex items-center gap-2"
            >
              <svg className="h-4 w-4 animate-spin text-(--on-accent)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Salvando…
            </motion.div>
          ) : (
            <motion.div
              key="save"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
            >
              Salvar mensagem
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </aside>
  );
}
