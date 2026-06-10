"use client";

import { useState, useTransition } from "react";
import { getLeads } from "@/lib/actions/lead-actions";
import type { Lead } from "@/lib/types/database";
import { CommandBar, CommandSearch, KpiPill } from "@/components/dashboard/console/command-bar";
import { DataGrid, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

interface LeadsTableProps {
  botId: string;
  initialLeads: Lead[];
  total: number;
  currentPage: number;
  pageSize: number;
}

export function LeadsTable({ botId, initialLeads, total, currentPage, pageSize }: LeadsTableProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [page, setPage] = useState(currentPage);
  const [count, setCount] = useState(total);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasMore = leads.length < count;

  const runSearch = (q: string) => {
    setSearch(q);
    startTransition(async () => {
      const result = await getLeads(botId, 1, q);
      setLeads(result.leads as Lead[]);
      setCount(result.total);
      setPage(1);
    });
  };

  const loadMore = () => {
    startTransition(async () => {
      const next = page + 1;
      const result = await getLeads(botId, next, search);
      setLeads((prev) => [...prev, ...(result.leads as Lead[])]);
      setCount(result.total);
      setPage(next);
    });
  };

  const columns: Column<Lead>[] = [
    {
      key: "name",
      header: "Lead",
      cell: (l) => (
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-[11px] font-bold stat-value" style={{ background: "color-mix(in srgb, var(--cyan) 14%, transparent)", color: "var(--cyan)" }}>
            {(l.first_name || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-foreground font-medium truncate">{l.first_name || "—"}</p>
            <p className="text-[10px] text-(--text-ghost)">{l.username ? `@${l.username}` : "sem username"}</p>
          </div>
        </div>
      ),
    },
    { key: "tgid", header: "Telegram ID", secondary: true, cell: (l) => <span className="text-(--text-muted) text-xs font-mono stat-value">{l.telegram_user_id}</span> },
    { key: "source", header: "Fonte", secondary: true, cell: (l) => (l.utm_source ? <span className="badge badge-purple">{l.utm_source}</span> : <span className="text-(--text-ghost)">—</span>) },
    { key: "tid", header: "TID", secondary: true, cell: (l) => <span className="text-(--text-muted) text-xs font-mono stat-value">{l.tid ?? "—"}</span> },
    { key: "created", header: "Criado", align: "right", secondary: true, cell: (l) => <span className="text-(--text-muted) text-xs">{new Date(l.created_at).toLocaleDateString("pt-BR")}</span> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Leads"
        subtitle="base de contatos"
        search={<CommandSearch value={search} onChange={runSearch} placeholder="Buscar por nome ou @username..." />}
        kpis={<KpiPill label="total" value={count.toLocaleString("pt-BR")} accent="cyan" />}
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6">
        <div className="card overflow-x-auto">
          <DataGrid
            columns={columns}
            rows={leads}
            rowKey={(l) => l.id}
            onRowClick={(l) => setSelected(l)}
            selectedKey={selected?.id ?? null}
            empty="Nenhum lead encontrado"
          />
        </div>

        {hasMore && (
          <div className="flex justify-center mt-5">
            <button onClick={loadMore} disabled={isPending} className="btn-ghost disabled:opacity-30">
              {isPending ? "Carregando..." : `Carregar mais (${count - leads.length})`}
            </button>
          </div>
        )}
      </div>

      <ContextDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.first_name || "Lead"}
        subtitle={selected?.username ? `@${selected.username}` : "detalhe do lead"}
      >
        {selected && (
          <div className="space-y-4">
            <DetailRow label="Nome" value={selected.first_name || "—"} />
            <DetailRow label="Username" value={selected.username ? `@${selected.username}` : "—"} />
            <DetailRow label="Telegram ID" value={String(selected.telegram_user_id)} mono />
            <DetailRow label="TID" value={selected.tid ?? "—"} mono />
            <div className="divider my-2" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Atribuição (UTM)</p>
            <DetailRow label="Source" value={selected.utm_source ?? "—"} />
            <DetailRow label="Medium" value={selected.utm_medium ?? "—"} />
            <DetailRow label="Campaign" value={selected.utm_campaign ?? "—"} />
            <DetailRow label="Content" value={selected.utm_content ?? "—"} />
            <DetailRow label="Term" value={selected.utm_term ?? "—"} />
            <div className="divider my-2" />
            <DetailRow label="Criado em" value={new Date(selected.created_at).toLocaleString("pt-BR")} />
          </div>
        )}
      </ContextDrawer>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">{label}</span>
      <span className={`text-sm text-foreground text-right truncate ${mono ? "font-mono stat-value text-xs" : ""}`}>{value}</span>
    </div>
  );
}
