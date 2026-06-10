"use client";

import { useState, useTransition } from "react";
import { getTransactions } from "@/lib/actions/transaction-actions";
import { getOrphanedTransactions, redeliverAccess } from "@/lib/actions/orphaned-transactions-actions";
import { CommandBar, KpiPill, FilterChip } from "@/components/dashboard/console/command-bar";
import { DataGrid, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

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

/** Linha de transação órfã ("pagou e não recebeu") — vinda de getOrphanedTransactions. */
interface OrphanRow {
  id: string;
  external_id: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  product_name: string;
  telegram_user_id: number | null;
  first_name: string;
  lead_id: string;
}

/** União apresentada na grid: transação normal ou órfã (com flag e dados de comprador). */
type GridRow = TransactionRow & { __orphan?: boolean; first_name?: string; telegram_user_id?: number | null };

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

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "approved", label: "Aprovadas" },
  { key: "pending", label: "Pendentes" },
  { key: "refused", label: "Recusadas" },
  { key: "refunded", label: "Reembolsadas" },
];

const fmtMoney = (cents: number, currency: string = "BRL") =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency });

/** Converte uma órfã na forma de TransactionRow pra reaproveitar a grid/drawer. */
function orphanToGridRow(o: OrphanRow): GridRow {
  return {
    id: o.id,
    external_id: o.external_id,
    amount: o.amount,
    currency: o.currency,
    status: "approved",
    created_at: o.created_at,
    paid_at: o.paid_at,
    products: { name: o.product_name },
    __orphan: true,
    first_name: o.first_name,
    telegram_user_id: o.telegram_user_id,
  };
}

export function TransactionsTable({ botId, initialTransactions, total, currentPage, pageSize, stats }: TransactionsTableProps) {
  const [transactions, setTransactions] = useState<GridRow[]>(initialTransactions);
  const [page, setPage] = useState(currentPage);
  const [count, setCount] = useState(total);
  const [filter, setFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  // Órfãs ("pagou e não recebeu") — carregadas sob demanda via server action existente.
  const [orphans, setOrphans] = useState<OrphanRow[] | null>(null);
  const [orphanCount, setOrphanCount] = useState<number | null>(null);

  // Drawer de detalhe + estado de reenvio por transação.
  const [selected, setSelected] = useState<GridRow | null>(null);
  const [resending, startResend] = useTransition();
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const showingOrphans = filter === "orphaned";
  const totalPages = showingOrphans ? 1 : Math.ceil(count / pageSize);

  const loadOrphans = () => {
    startTransition(async () => {
      const result = await getOrphanedTransactions(botId);
      setOrphans(result.transactions as OrphanRow[]);
      setOrphanCount(result.total);
    });
  };

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
    if (newFilter === "orphaned") {
      loadOrphans();
    } else {
      loadPage(1, newFilter);
    }
  };

  const handleResend = (txId: string) => {
    if (
      !confirm(
        "Reenviar o acesso para este comprador que pagou mas não teve entrega confirmada?\n\n" +
          "Ele recebe de novo o fluxo de produto/mensagens. O Facebook/Utmify NÃO são notificados de novo (sem duplicar venda).",
      )
    ) {
      return;
    }
    setResendMsg(null);
    startResend(async () => {
      try {
        const r = await redeliverAccess(botId, [txId]);
        setResendMsg(`✅ Reenvio iniciado para ${r.queued} comprador(es). Acontece em segundo plano.`);
      } catch (e) {
        setResendMsg(`❌ ${e instanceof Error ? e.message : "erro ao reenviar"}`);
      }
    });
  };

  const rows: GridRow[] = showingOrphans ? (orphans ?? []).map(orphanToGridRow) : transactions;

  const columns: Column<GridRow>[] = [
    {
      key: "created",
      header: "Data",
      cell: (tx) => (
        <span className="text-(--text-muted) text-xs">{new Date(tx.created_at).toLocaleDateString("pt-BR")}</span>
      ),
    },
    {
      key: "product",
      header: "Produto",
      cell: (tx) => {
        const productName = tx.products?.ghost_name || tx.products?.name || "—";
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-foreground font-medium truncate">{productName}</span>
            {tx.__orphan && (
              <span className="badge badge-error text-[9px]! py-0.5! px-1.5! shrink-0">órfã</span>
            )}
          </div>
        );
      },
    },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      cell: (tx) => <span className="stat-value text-sm text-foreground">{fmtMoney(tx.amount, tx.currency)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (tx) => (
        <span className={`badge ${statusBadge[tx.status] ?? "badge-inactive"}`}>
          {statusLabels[tx.status] ?? tx.status}
        </span>
      ),
    },
    {
      key: "gateway",
      header: "Gateway",
      align: "right",
      secondary: true,
      cell: (tx) => <span className="text-(--text-ghost) text-xs font-mono stat-value">{tx.external_id}</span>,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Transações"
        subtitle="pagamentos e entregas"
        filters={
          <>
            {FILTERS.map((f) => (
              <FilterChip key={f.key} active={filter === f.key} onClick={() => handleFilter(f.key)}>
                {f.label}
              </FilterChip>
            ))}
            <FilterChip
              active={showingOrphans}
              onClick={() => handleFilter("orphaned")}
              count={orphanCount ?? undefined}
            >
              Órfãs
            </FilterChip>
          </>
        }
        kpis={
          <>
            <KpiPill label="receita" value={fmtMoney(stats.totalRevenue)} accent="magenta" />
            <KpiPill label="aprovadas" value={String(stats.totalSales)} accent="cyan" />
            <KpiPill label="pendentes" value={String(stats.pendingCount)} accent="amber" />
            <KpiPill label="órfãs" value={orphanCount !== null ? String(orphanCount) : "—"} accent="red" />
          </>
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6">
        {showingOrphans && (
          <p className="text-(--text-secondary) text-sm mb-4">
            {orphans === null
              ? "Carregando transações que pagaram mas não receberam…"
              : orphanCount === 0
                ? "Nenhuma transação órfã — todo pagamento aprovado teve entrega confirmada. ✅"
                : `${orphanCount} transação(ões) aprovada(s) sem confirmação de entrega. Abra uma para reenviar o acesso.`}
          </p>
        )}

        <div className="card overflow-x-auto">
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={(tx) => tx.id}
            onRowClick={(tx) => {
              setResendMsg(null);
              setSelected(tx);
            }}
            selectedKey={selected?.id ?? null}
            empty={showingOrphans ? "Nenhuma transação órfã" : "Nenhuma transação encontrada"}
          />
        </div>

        {!showingOrphans && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <button onClick={() => loadPage(page - 1)} disabled={page <= 1 || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">
              Anterior
            </button>
            <span className="text-(--text-muted) text-sm stat-value px-3 py-1.5 rounded-lg bg-white/3">{page} / {totalPages}</span>
            <button onClick={() => loadPage(page + 1)} disabled={page >= totalPages || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">
              Próxima
            </button>
          </div>
        )}
      </div>

      <ContextDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? (selected.products?.ghost_name || selected.products?.name || "Transação") : "Transação"}
        subtitle={selected?.__orphan ? "pagou e não recebeu" : "detalhe da transação"}
        actions={
          selected ? (
            <a
              href={`/dashboard/sales/${selected.id}/proof`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost py-1.5! px-3! text-xs!"
            >
              Ver prova ↗
            </a>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-4">
            <DetailRow label="Produto" value={selected.products?.ghost_name || selected.products?.name || "—"} />
            <DetailRow label="Valor" value={fmtMoney(selected.amount, selected.currency)} />
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">Status</span>
              <span className={`badge ${statusBadge[selected.status] ?? "badge-inactive"}`}>
                {statusLabels[selected.status] ?? selected.status}
              </span>
            </div>
            <DetailRow label="Gateway / ID Externo" value={selected.external_id} mono />
            {selected.__orphan && (
              <>
                <DetailRow label="Comprador" value={selected.first_name || "—"} />
                <DetailRow label="Telegram ID" value={selected.telegram_user_id != null ? String(selected.telegram_user_id) : "—"} mono />
              </>
            )}
            <div className="divider my-2" />
            <DetailRow label="Criado em" value={new Date(selected.created_at).toLocaleString("pt-BR")} />
            <DetailRow
              label="Pago em"
              value={selected.paid_at ? new Date(selected.paid_at).toLocaleString("pt-BR") : "—"}
            />

            <div className="divider my-2" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Comprovação</p>
            <a
              href={`/dashboard/sales/${selected.id}/proof`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--accent) hover:underline text-xs font-medium inline-block"
            >
              Ver prova ↗
            </a>

            {selected.__orphan && (
              <>
                <div className="divider my-2" />
                <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Pagou e não recebeu</p>
                <p className="text-(--text-secondary) text-xs leading-relaxed">
                  Este comprador pagou mas a entrega nunca foi confirmada. Reenvie o acesso para reexecutar o fluxo de
                  produto/mensagens. Tracking não é duplicado.
                </p>
                <button
                  onClick={() => handleResend(selected.id)}
                  disabled={resending}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {resending ? "Reenviando…" : "Reenviar acesso"}
                </button>
                {resendMsg && (
                  <div className="px-4 py-3 rounded-xl border border-(--border-subtle) text-sm text-(--text-secondary) bg-white/2">
                    {resendMsg}
                  </div>
                )}
              </>
            )}
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
