"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getClients,
  type ClientRow,
  type ClientStatus,
  type ClientsResult,
} from "@/lib/actions/client-actions";
import { CommandBar, CommandSearch, KpiPill, FilterChip } from "@/components/dashboard/console/command-bar";
import { ChatPanel } from "@/components/dashboard/clients/chat-panel";

interface ClientsViewProps {
  botId: string;
  initial: ClientsResult;
}

const SEGMENTS: { id: ClientStatus | "all"; label: string; dot: string }[] = [
  { id: "all", label: "Todos", dot: "var(--text-muted)" },
  { id: "paid", label: "Pagaram", dot: "var(--green, #22e0a1)" },
  { id: "pending", label: "Pendentes", dot: "var(--amber)" },
  { id: "new", label: "Novos", dot: "var(--cyan)" },
  { id: "blocked", label: "Bloquearam", dot: "var(--red)" },
];

const STATUS_META: Record<ClientStatus, { label: string; color: string; bg: string }> = {
  paid: { label: "Pagou", color: "var(--green, #22e0a1)", bg: "color-mix(in srgb, var(--green, #22e0a1) 14%, transparent)" },
  pending: { label: "Pendente", color: "var(--amber)", bg: "color-mix(in srgb, var(--amber) 14%, transparent)" },
  new: { label: "Novo", color: "var(--cyan)", bg: "color-mix(in srgb, var(--cyan) 14%, transparent)" },
  blocked: { label: "Bloqueou", color: "var(--red)", bg: "color-mix(in srgb, var(--red) 14%, transparent)" },
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function ClientsView({ botId, initial }: ClientsViewProps) {
  const [data, setData] = useState<ClientsResult>(initial);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<ClientStatus | "all">("all");
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const reload = (opts: { search?: string; segment?: ClientStatus | "all"; page?: number; append?: boolean }) => {
    startTransition(async () => {
      const res = await getClients(botId, {
        search: opts.search ?? search,
        segment: opts.segment ?? segment,
        page: opts.page ?? 1,
      });
      setData((prev) =>
        opts.append ? { ...res, clients: [...prev.clients, ...res.clients] } : res,
      );
    });
  };

  // Debounce: atualiza o input na hora, mas só busca no server após 350ms
  // parado. Pula a 1ª render (já temos os dados iniciais do server).
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => {
      reload({ search, page: 1 });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, touched]);

  const onSearch = (q: string) => {
    setTouched(true);
    setSearch(q);
  };
  const onSegment = (s: ClientStatus | "all") => {
    setSegment(s);
    reload({ segment: s, page: 1 });
  };
  const loadMore = () => reload({ page: data.page + 1, append: true });

  const hasMore = data.clients.length < data.total;
  const c = data.counts;

  return (
    <div className="flex flex-col h-full min-h-0">
      <CommandBar
        title="Clientes"
        subtitle={`${c.all.toLocaleString("pt-BR")} contatos · veja a conversa e responda pelo bot`}
        kpis={
          <>
            <KpiPill label="Pagaram" value={c.paid.toLocaleString("pt-BR")} accent="cyan" />
            <KpiPill label="Pendentes" value={c.pending.toLocaleString("pt-BR")} accent="amber" />
            <KpiPill label="Bloquearam" value={c.blocked.toLocaleString("pt-BR")} accent="red" />
          </>
        }
        search={<CommandSearch value={search} onChange={onSearch} placeholder="Buscar por nome ou @username..." />}
        filters={
          <>
            {SEGMENTS.map((s) => (
              <FilterChip key={s.id} active={segment === s.id} onClick={() => onSegment(s.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                  {s.label}
                  {s.id !== "all" && (
                    <span className="text-(--text-ghost) tabular-nums">
                      {s.id === "paid" ? c.paid : s.id === "pending" ? c.pending : s.id === "new" ? c.new : c.blocked}
                    </span>
                  )}
                </span>
              </FilterChip>
            ))}
          </>
        }
      />

      {/* Master-detail: lista à esquerda, chat à direita */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_1fr] gap-0 border-t border-(--border-subtle)">
        {/* Lista de clientes */}
        <div
          className={`min-h-0 overflow-y-auto border-r border-(--border-subtle) ${
            selected ? "hidden lg:block" : "block"
          }`}
        >
          {isPending && data.clients.length === 0 ? (
            <ListSkeleton />
          ) : data.clients.length === 0 ? (
            <EmptyList segment={segment} />
          ) : (
            <ul className="divide-y divide-(--border-subtle)/60">
              {data.clients.map((row) => {
                const meta = STATUS_META[row.status];
                const active = selected?.lead.id === row.lead.id;
                const name = [row.lead.first_name, row.lead.last_name].filter(Boolean).join(" ") || "Sem nome";
                return (
                  <li key={row.lead.id}>
                    <button
                      onClick={() => setSelected(row)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors relative group ${
                        active ? "bg-(--accent)/[0.06]" : "hover:bg-white/[0.02]"
                      }`}
                    >
                      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-(--accent)" style={{ boxShadow: "0 0 8px var(--accent)" }} />}
                      <span
                        className="w-9 h-9 shrink-0 rounded-xl grid place-items-center text-[11px] font-bold"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {initials(name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
                          {row.lead.blocked && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.2" className="shrink-0">
                              <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5 mt-0.5">
                          {row.lead.username ? (
                            <span className="truncate text-[11px] text-(--text-muted)">@{row.lead.username}</span>
                          ) : (
                            <span className="text-[11px] text-(--text-ghost)">ID {row.lead.telegram_user_id}</span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 flex flex-col items-end gap-1">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                        {row.paidAmount > 0 && (
                          <span className="text-[10px] font-mono text-(--green, #22e0a1)">{brl(row.paidAmount)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasMore && (
                <li className="p-3">
                  <button onClick={loadMore} disabled={isPending} className="btn-ghost w-full text-xs! py-2!">
                    {isPending ? "Carregando..." : `Carregar mais (${data.total - data.clients.length})`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Chat do lead selecionado */}
        <div className={`min-h-0 ${selected ? "block" : "hidden lg:block"}`}>
          {selected ? (
            <ChatPanel
              key={selected.lead.id}
              botId={botId}
              lead={selected.lead}
              status={selected.status}
              onBack={() => setSelected(null)}
            />
          ) : (
            <ChatEmpty />
          )}
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-(--border-subtle)/60">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="px-4 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-white/[0.04] animate-pulse" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-32 rounded bg-white/[0.04] animate-pulse" />
            <span className="block h-2.5 w-20 rounded bg-white/[0.03] animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmptyList({ segment }: { segment: ClientStatus | "all" }) {
  const msg =
    segment === "blocked"
      ? "Ninguém bloqueou o bot ainda."
      : segment === "paid"
        ? "Nenhum cliente pagante neste filtro."
        : segment === "pending"
          ? "Nenhum pagamento pendente."
          : "Nenhum cliente encontrado.";
  return (
    <div className="h-full grid place-items-center p-8 text-center">
      <div>
        <div className="w-12 h-12 mx-auto rounded-2xl bg-white/[0.03] grid place-items-center mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.6">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />
          </svg>
        </div>
        <p className="text-sm text-(--text-muted)">{msg}</p>
      </div>
    </div>
  );
}

function ChatEmpty() {
  return (
    <div className="h-full grid place-items-center p-8 text-center">
      <div className="max-w-xs">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-(--accent)/[0.08] grid place-items-center mb-4" style={{ boxShadow: "0 0 30px -10px var(--accent-glow)" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
        <h3 className="text-foreground font-semibold tracking-tight">Selecione um cliente</h3>
        <p className="text-[13px] text-(--text-muted) mt-1.5">
          Veja a conversa que o bot teve com ele, o que clicou no funil, e responda direto pelo bot.
        </p>
      </div>
    </div>
  );
}
