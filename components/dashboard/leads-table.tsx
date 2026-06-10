"use client";

import { useState, useTransition } from "react";
import { getLeads } from "@/lib/actions/lead-actions";
import type { Lead } from "@/lib/types/database";

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
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.ceil(count / pageSize);

  const loadPage = (newPage: number, searchQuery?: string) => {
    startTransition(async () => {
      const result = await getLeads(botId, newPage, searchQuery ?? search);
      setLeads(result.leads as Lead[]);
      setCount(result.total);
      setPage(newPage);
    });
  };

  const handleSearch = () => {
    loadPage(1, search);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight page-title">Leads</h1>
          <p className="text-(--text-secondary) text-sm mt-1">
            <span className="stat-value text-(--cyan)">{count}</span> leads no total
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Buscar por nome ou username..."
            className="input w-full sm:w-64"
          />
          <button onClick={handleSearch} className="btn-primary">Buscar</button>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="text-center py-20 animate-up">
          <div className="section-icon w-14 h-14 mx-auto mb-4" style={{ background: "linear-gradient(135deg, var(--cyan-muted) 0%, rgba(0,229,255,0.04) 100%)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
          </div>
          <p className="text-(--text-muted) text-sm">Nenhum lead encontrado</p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden relative">
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--cyan)/15 to-transparent" />
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-(--border-subtle)">
                    <th className="table-header whitespace-nowrap">Nome</th>
                    <th className="table-header whitespace-nowrap">Username</th>
                    <th className="table-header whitespace-nowrap hidden sm:table-cell">Telegram ID</th>
                    <th className="table-header whitespace-nowrap hidden sm:table-cell">Fonte</th>
                    <th className="table-header whitespace-nowrap hidden sm:table-cell">TID</th>
                    <th className="table-header whitespace-nowrap hidden sm:table-cell">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-white/2 transition-colors group">
                      <td className="table-cell text-foreground font-medium whitespace-nowrap">{lead.first_name}</td>
                      <td className="table-cell text-(--text-secondary) whitespace-nowrap">{lead.username ? `@${lead.username}` : "—"}</td>
                      <td className="table-cell text-(--text-muted) text-xs font-mono stat-value whitespace-nowrap hidden sm:table-cell">{lead.telegram_user_id}</td>
                      <td className="table-cell whitespace-nowrap hidden sm:table-cell">
                        {lead.utm_source ? (
                          <span className="badge badge-purple">{lead.utm_source}</span>
                        ) : (
                          <span className="text-(--text-ghost)">—</span>
                        )}
                      </td>
                      <td className="table-cell text-(--text-muted) text-xs font-mono stat-value whitespace-nowrap hidden sm:table-cell">{lead.tid ?? "—"}</td>
                      <td className="table-cell text-(--text-muted) text-xs whitespace-nowrap hidden sm:table-cell">
                        {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5">
              <button
                onClick={() => loadPage(page - 1)}
                disabled={page <= 1 || isPending}
                className="btn-ghost py-2! px-4! disabled:opacity-30"
              >
                Anterior
              </button>
              <span className="text-(--text-muted) text-sm stat-value px-3 py-1.5 rounded-lg bg-white/3">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => loadPage(page + 1)}
                disabled={page >= totalPages || isPending}
                className="btn-ghost py-2! px-4! disabled:opacity-30"
              >
                Proxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
