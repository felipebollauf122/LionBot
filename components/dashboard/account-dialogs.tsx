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

export function AccountDialogs({ accountId, hasBot }: { accountId: string; hasBot: boolean }) {
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
      <div className="flex items-center gap-2 mb-4">
        {TABS.map((t) => {
          const count = rows.filter((r) => t.kinds.includes(r.kind as never)).length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm ${
                tab === t.id
                  ? "bg-(--accent) text-black font-medium"
                  : "border border-white/15 text-white/70 hover:bg-white/5"
              }`}
            >
              {t.label} <span className="opacity-60">{count}</span>
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
          className="ml-auto text-white/40 hover:text-white text-xs disabled:opacity-50"
        >
          {pending ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou @username"
        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white mb-4"
      />

      {loading && <p className="text-white/40 text-sm">Carregando...</p>}
      {!loading && visible.length === 0 && (
        <p className="text-white/40 text-sm">
          Nada aqui. Se a conta acabou de conectar, use &quot;Sincronizar agora&quot;.
        </p>
      )}

      <div className="space-y-1">
        {visible.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between px-3 py-2 rounded-md border border-white/10 bg-white/[0.02]"
          >
            <div className="min-w-0">
              <div className="text-white text-sm truncate">{d.title ?? d.username ?? d.id}</div>
              <div className="text-white/40 text-xs">
                {d.username ? `@${d.username} · ` : ""}
                {KIND_LABEL[d.kind] ?? d.kind}
              </div>
            </div>
            {isClonableKind(d.kind) &&
              (hasBot ? (
                <a
                  href={`/dashboard/automations/clones/new?dialogId=${d.id}`}
                  className="shrink-0 px-3 py-1 rounded bg-(--accent) text-black text-xs font-medium"
                >
                  Clonar
                </a>
              ) : (
                <span
                  title="Cadastre o bot companheiro em Automações para poder clonar"
                  className="shrink-0 px-3 py-1 rounded border border-white/10 text-white/30 text-xs cursor-not-allowed"
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
