"use client";

import type { MessageInput, MessageKind, SenderKind } from "@/lib/social-proof/types";
import { MediaPicker } from "@/components/dashboard/social-proof/media-picker";

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
        <button type="button" onClick={onDelete} className="text-(--red)" aria-label="Excluir">
          🗑
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
          {error}
        </p>
      )}

      {/* Enviar como — dois cartões, nunca um select */}
      <div className="space-y-2">
        <p className="text-xs text-(--text-muted)">Enviar como</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { kind: "owner" as SenderKind, titulo: "Dona do canal", sub: "Aparece como a dona" },
            { kind: "member" as SenderKind, titulo: "Membro", sub: "Aparece como membro" },
          ]).map((op) => (
            <button
              key={op.kind}
              type="button"
              onClick={() => onChange({ ...value, sender_kind: op.kind })}
              className={`rounded-lg border p-3 text-left ${
                value.sender_kind === op.kind
                  ? "border-(--accent) bg-(--accent-deep)"
                  : "border-(--border-default) hover:bg-(--bg-hover)"
              }`}
            >
              <p className="text-sm font-medium text-(--text-primary)">{op.titulo}</p>
              <p className="text-xs text-(--text-muted)">{op.sub}</p>
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
        <div className="grid grid-cols-5 gap-1 rounded-lg border border-(--border-default) p-1">
          {TIPOS.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => {
                // Trocar de tipo apara a mídia para o que o tipo novo aceita.
                // Sair de "Álbum" com 3 fotos deixaria kind e media divergentes,
                // e a validação só olha media[0] — a mensagem gravaria com o
                // rótulo errado na lista.
                const media =
                  t.kind === "album"
                    ? value.media
                    : t.kind === "text"
                      ? []
                      : value.media.filter((m) => m.type === t.kind).slice(0, 1);
                onChange({ ...value, kind: t.kind, media });
              }}
              className={`rounded-md py-1.5 text-xs ${
                value.kind === t.kind
                  ? "bg-(--accent) text-(--on-accent)"
                  : "text-(--text-secondary) hover:bg-(--bg-hover)"
              }`}
            >
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

      <div className="grid grid-cols-2 gap-2 border-t border-(--border-subtle) pt-4">
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded-lg border border-(--border-default) py-2 text-sm text-(--text-secondary)"
        >
          Duplicar
        </button>
        <button
          type="button"
          onClick={onReply}
          className="rounded-lg border border-(--border-default) py-2 text-sm text-(--text-secondary)"
        >
          Responder
        </button>
        <button
          type="button"
          onClick={onPin}
          className="rounded-lg border border-(--border-default) py-2 text-sm text-(--text-secondary)"
        >
          Fixar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-(--red) py-2 text-sm text-(--red)"
        >
          Excluir
        </button>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-(--accent) py-2.5 text-sm font-medium text-(--on-accent) disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar mensagem"}
      </button>
    </aside>
  );
}
