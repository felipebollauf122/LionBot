"use client";

import type { MessageInput } from "@/lib/social-proof/types";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/** Paleta fixa. Um seletor completo de emoji é uma dependência inteira pra um
 *  caso em que sete opções cobrem quase tudo. */
const EMOJIS = ["❤️", "🔥", "👏", "😂", "😮", "🙏", "💎"];

/**
 * Os campos que só a Prova Social tem. Ela finge um histórico, então precisa
 * inventar visualizações, idade e reações da mensagem. A campanha posta de
 * verdade: o horário dela vem do agendamento e ninguém reage por ela.
 */
export function SocialProofExtras({
  value,
  onChange,
}: {
  value: MessageInput;
  onChange: (v: MessageInput) => void;
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
    <>
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
    </>
  );
}
