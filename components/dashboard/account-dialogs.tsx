"use client";

import { useEffect, useState, useTransition } from "react";
import { listAccountDialogs, syncAccountDialogs } from "@/app/dashboard/automations/actions";
import { isClonableKind } from "@/lib/mtproto/clone-kind";

type Dialog = {
  id: string;
  title: string | null;
  username: string | null;
  kind: string;
  peer_type: string;
  is_bot: boolean;
};

const TABS = [
  { id: "canais", label: "Canais", kinds: ["channel_owner", "channel_subscriber"] },
  { id: "grupos", label: "Grupos", kinds: ["group_admin", "group_member"] },
  { id: "bots", label: "Bots", kinds: ["bot"] },
  { id: "contatos", label: "Contatos", kinds: ["contact", "dm", "self"] },
] as const;

const KIND_LABEL: Record<string, string> = {
  channel_owner: "você administra",
  channel_subscriber: "você assina",
  group_admin: "você administra",
  group_member: "você participa",
};

export function AccountDialogs({
  accountId,
  hasBot,
  ownerTenantId,
}: {
  accountId: string;
  hasBot: boolean;
  /** Dono da conta (pode ser outro tenant, na visão admin) — vai no link de clonar. */
  ownerTenantId: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("canais");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Dialog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    // `loading` já nasce true (useState(true)); evita setState síncrono no corpo do efeito.
    listAccountDialogs(accountId)
      .then((data) => {
        if (alive) setRows(data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const active = TABS.find((t) => t.id === tab)!;
  const term = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      active.kinds.includes(r.kind as never) &&
      (!term || (r.title ?? "").toLowerCase().includes(term) || (r.username ?? "").toLowerCase().includes(term)),
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map((t) => {
          const count = rows.filter((r) => t.kinds.includes(r.kind as never)).length;
          const activeTab = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab
                  ? "text-foreground border border-(--border-strong) bg-(--accent-muted)"
                  : "text-(--text-secondary) border border-(--border-subtle) hover:bg-white/[0.03]"
              }`}
            >
              {t.label} <span className="text-(--text-ghost)">{count}</span>
            </button>
          );
        })}
        <button
          onClick={() =>
            start(async () => {
              try {
                await syncAccountDialogs(accountId);
                setRows(await listAccountDialogs(accountId));
                alert("Sincronização enfileirada. Em alguns segundos a lista será atualizada.");
              } catch (err) {
                alert(err instanceof Error ? err.message : "erro");
              }
            })
          }
          disabled={pending}
          className="ml-auto btn-ghost text-xs px-3 py-1.5 disabled:opacity-50"
        >
          {pending ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou @username"
        className="input mb-4"
      />

      {loading && <p className="py-6 text-center text-(--text-ghost) text-xs">Carregando...</p>}
      {!loading && visible.length === 0 && (
        <p className="py-6 text-center text-(--text-ghost) text-xs">
          Nada aqui. Se a conta acabou de conectar, use &quot;Sincronizar agora&quot;.
        </p>
      )}

      <div className="space-y-1.5">
        {visible.map((d) => (
          <div
            key={d.id}
            className="row-hover flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-(--border-subtle) bg-white/[0.02]"
          >
            <div className="min-w-0">
              <div className="text-foreground text-sm truncate">{d.title ?? d.username ?? d.id}</div>
              <div className="text-(--text-muted) text-xs">
                {d.username ? `@${d.username} · ` : ""}
                {KIND_LABEL[d.kind] ?? d.kind}
              </div>
            </div>
            {isClonableKind(d.kind) &&
              (hasBot ? (
                <a
                  href={`/dashboard/automations/clones/new?dialogId=${d.id}&view=${ownerTenantId}`}
                  className="btn-primary text-xs px-3 py-1.5 shrink-0"
                >
                  Clonar
                </a>
              ) : (
                <span
                  title="Cadastre o bot companheiro em Automações para poder clonar"
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-(--border-subtle) text-(--text-ghost) text-xs cursor-not-allowed"
                >
                  Clonar
                </span>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
