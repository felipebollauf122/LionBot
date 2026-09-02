"use client";

import type { ChannelInput } from "@/lib/social-proof/types";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/** Interruptor. Substitui checkbox pra bater com o mockup e ficar legível no escuro. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-(--text-secondary)">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-(--accent)" : "bg-(--bg-hover)"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function ChannelCard({
  value,
  onChange,
}: {
  value: ChannelInput;
  onChange: (v: ChannelInput) => void;
}) {
  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Canal</h2>

      <div className="flex items-center gap-3">
        {value.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--accent-muted) text-lg text-(--text-primary)">
            {value.title.trim().charAt(0).toUpperCase() || "#"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-(--text-primary)">
            {value.title || "Nome do canal"}
          </p>
          <p className="truncate text-sm text-(--text-muted)">
            {value.subscribers_label || "0 inscritos"}
          </p>
        </div>
      </div>

      <input
        className={CAMPO}
        placeholder="Nome do canal"
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
      />
      <input
        className={CAMPO}
        placeholder="URL do avatar do canal"
        value={value.avatar_url ?? ""}
        onChange={(e) => onChange({ ...value, avatar_url: e.target.value || null })}
      />
      <input
        className={CAMPO}
        placeholder="Linha de inscritos (ex.: 52 321 inscritos)"
        value={value.subscribers_label}
        onChange={(e) => onChange({ ...value, subscribers_label: e.target.value })}
      />
      <input
        className={CAMPO}
        type="number"
        min={0}
        placeholder="Badge de não lidas"
        value={value.unread_badge}
        onChange={(e) =>
          onChange({ ...value, unread_badge: Math.max(0, Number(e.target.value) || 0) })
        }
      />

      <Toggle
        label="Selo de verificação"
        checked={value.is_verified}
        onChange={(v) => onChange({ ...value, is_verified: v })}
      />
      <Toggle
        label="Ativo no Mini App"
        checked={value.is_active}
        onChange={(v) => onChange({ ...value, is_active: v })}
      />

      {!value.is_active && (
        <p className="rounded-md bg-(--amber-muted) px-3 py-2 text-xs text-(--amber)">
          Enquanto isto estiver desligado, o lead que abrir o Mini App verá uma
          página de erro.
        </p>
      )}
    </section>
  );
}
