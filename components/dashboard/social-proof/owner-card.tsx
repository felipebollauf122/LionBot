"use client";

import type { ChannelInput } from "@/lib/social-proof/types";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

/**
 * Identidade do admin — separada do canal de propósito. Mensagens marcadas
 * como admin usam estes campos, não os da mensagem.
 */
export function OwnerCard({
  value,
  onChange,
}: {
  value: ChannelInput;
  onChange: (v: ChannelInput) => void;
}) {
  return (
    <section className="rounded-xl border border-(--border-subtle) p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
        Identidade do admin
      </h2>

      <div className="flex items-center gap-3">
        {value.owner_avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.owner_avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--purple-muted) text-lg text-(--text-primary)">
            {value.owner_name.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-(--text-primary)">
            {value.owner_name || "Nome do admin"}
          </p>
          <p className="truncate text-sm text-(--text-muted)">
            @{value.owner_username || "usuario"}
          </p>
        </div>
      </div>

      <input
        className={CAMPO}
        placeholder="Nome do admin"
        value={value.owner_name}
        onChange={(e) => onChange({ ...value, owner_name: e.target.value })}
      />
      <input
        className={CAMPO}
        placeholder="@usuario"
        value={value.owner_username}
        onChange={(e) => onChange({ ...value, owner_username: e.target.value.replace(/^@/, "") })}
      />
      <input
        className={CAMPO}
        placeholder="URL do avatar da dona"
        value={value.owner_avatar_url ?? ""}
        onChange={(e) => onChange({ ...value, owner_avatar_url: e.target.value || null })}
      />
    </section>
  );
}
