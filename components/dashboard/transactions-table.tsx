"use client";

import { useState, useTransition } from "react";
import { getTransactions } from "@/lib/actions/transaction-actions";

interface TransactionRow {
  id: string;
  external_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  products: { name: string; ghost_name?: string | null } | null;
}

interface TransactionsTableProps {
  botId: string;
  initialTransactions: TransactionRow[];
  total: number;
  currentPage: number;
  pageSize: number;
  stats: { totalRevenue: number; totalSales: number; pendingCount: number };
}

const statusBadge: Record<string, string> = {
  approved: "badge-active",
  pending: "badge-pending",
  refused: "badge-error",
  refunded: "badge-inactive",
};

const statusLabels: Record<string, string> = {
  approved: "Aprovado",
  pending: "Pendente",
  refused: "Recusado",
  refunded: "Reembolsado",
};

const statMeta = [
  { key: "revenue", label: "Receita Total", color: "var(--accent)", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" },
  { key: "sales", label: "Vendas Aprovadas", color: "var(--accent)", icon: "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3" },
  { key: "pending", label: "Pendentes", color: "var(--amber)", icon: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" },
];

export function TransactionsTable({ botId, initialTransactions, total, currentPage, pageSize, stats }: TransactionsTableProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [page, setPage] = useState(currentPage);
  const [count, setCount] = useState(total);
  const [filter, setFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.ceil(count / pageSize);

  const loadPage = (newPage: number, statusFilter?: string) => {
    startTransition(async () => {
      const result = await getTransactions(botId, newPage, statusFilter ?? filter);
      setTransactions(result.transactions as TransactionRow[]);
      setCount(result.total);
      setPage(newPage);
    });
  };

  const handleFilter = (newFilter: string) => {
    setFilter(newFilter);
    loadPage(1, newFilter);
  };

  const statValues = [
    (stats.totalRevenue / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    String(stats.totalSales),
    String(stats.pendingCount),
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground tracking-tight page-title mb-1">Transacoes</h1>
      <p className="text-(--text-secondary) text-sm mb-6">
        <span className="stat-value">{count}</span> transacoes no total
      </p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {statMeta.map((s, i) => (
          <div key={s.key} className="card p-5 relative group">
            <div className="absolute top-0 left-4 right-4 h-px opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(90deg, transparent, ${s.color}, transparent)` }} />
            <div className="flex items-center justify-between mb-3">
              <p className="text-(--text-muted) text-[10px] font-bold uppercase tracking-[0.08em]">{s.label}</p>
              <div className="section-icon w-8 h-8" style={{ background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={s.icon} />
                </svg>
              </div>
            </div>
            <p className="stat-value text-xl" style={{ color: s.color }}>{statValues[i]}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5">
        {["all", "approved", "pending", "refused", "refunded"].map((f) => (
          <button
            key={f}
            onClick={() => handleFilter(f)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              filter === f
                ? "text-white"
                : "bg-white/3 text-(--text-muted) hover:bg-white/6 hover:text-(--text-secondary) border border-(--border-subtle)"
            }`}
            style={filter === f ? { background: "linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)", boxShadow: "0 0 16px -4px var(--accent-glow)" } : {}}
          >
            {f === "all" ? "Todas" : statusLabels[f]}
          </button>
        ))}
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-20 animate-up">
          <div className="section-icon w-14 h-14 mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(255, 43, 214, 0.12) 0%, rgba(255, 43, 214, 0.04) 100%)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          </div>
          <p className="text-(--text-muted) text-sm">Nenhuma transacao encontrada</p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden relative">
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
            <table className="w-full">
              <thead>
                <tr className="border-b border-(--border-subtle)">
                  <th className="table-header">Produto</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Data</th>
                  <th className="table-header">ID Externo</th>
                  <th className="table-header">Comprovação</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const productName = tx.products?.ghost_name || tx.products?.name || "—";
                  return (
                    <tr key={tx.id} className="hover:bg-white/2 transition-colors">
                      <td className="table-cell text-foreground text-sm font-medium">{productName}</td>
                      <td className="table-cell stat-value text-sm text-foreground">
                        {(tx.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: tx.currency })}
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${statusBadge[tx.status] ?? "badge-inactive"}`}>
                          {statusLabels[tx.status] ?? tx.status}
                        </span>
                      </td>
                      <td className="table-cell text-(--text-muted) text-xs">
                        {new Date(tx.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="table-cell text-(--text-ghost) text-xs font-mono stat-value">{tx.external_id}</td>
                      <td className="table-cell">
                        <a
                          href={`/dashboard/sales/${tx.id}/proof`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-(--accent) hover:underline text-xs font-medium"
                        >
                          Ver prova ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5">
              <button onClick={() => loadPage(page - 1)} disabled={page <= 1 || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">
                Anterior
              </button>
              <span className="text-(--text-muted) text-sm stat-value px-3 py-1.5 rounded-lg bg-white/3">{page} / {totalPages}</span>
              <button onClick={() => loadPage(page + 1)} disabled={page >= totalPages || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">
                Proxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
