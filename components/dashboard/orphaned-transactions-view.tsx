"use client";

import { useState, useTransition } from "react";
import { redeliverAccess } from "@/lib/actions/orphaned-transactions-actions";

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

export function OrphanedTransactionsView({
  botId,
  transactions,
  total,
}: {
  botId: string;
  transactions: OrphanRow[];
  total: number;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function handleResendAll() {
    if (
      !confirm(
        `Reenviar o acesso para os ${total} compradores que pagaram mas não tiveram entrega confirmada?\n\n` +
          `Cada um vai receber de novo o fluxo de produto/mensagens. O Facebook/Utmify NÃO são notificados de novo (sem duplicar venda). O envio é espaçado pra não bloquear o bot.`,
      )
    ) {
      return;
    }
    setMsg(null);
    startTransition(async () => {
      try {
        const r = await redeliverAccess(botId, transactions.map((t) => t.id));
        setMsg(
          `✅ Reenvio iniciado para ${r.queued} comprador(es). O envio acontece em segundo plano (espaçado). Recarregue a página em alguns minutos — quem receber sai desta lista.`,
        );
      } catch (e) {
        setMsg(`❌ ${e instanceof Error ? e.message : "erro ao reenviar"}`);
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Pagou e não recebeu</h1>
          <p className="text-(--text-secondary) text-sm">
            {total === 0
              ? "Nenhuma transação órfã — todo pagamento aprovado teve entrega confirmada. ✅"
              : `${total} transação(ões) aprovada(s) sem confirmação de entrega.`}
          </p>
        </div>
        {total > 0 && (
          <button
            onClick={handleResendAll}
            disabled={pending}
            className="px-4 py-2 rounded-md bg-(--accent) text-black text-sm font-semibold hover:opacity-90 disabled:opacity-50 shrink-0"
          >
            {pending ? "Reenviando…" : `Reenviar acesso a todos (${total})`}
          </button>
        )}
      </div>

      {msg && (
        <div className="mb-5 px-4 py-3 rounded-xl border border-(--border-subtle) text-sm text-(--text-secondary) bg-white/2">
          {msg}
        </div>
      )}

      {total > 0 && (
        <div className="overflow-x-auto rounded-xl border border-(--border-subtle)">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--border-subtle) text-left text-(--text-muted) text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Comprador</th>
                <th className="px-4 py-3">Telegram ID</th>
                <th className="px-4 py-3">Pago em</th>
                <th className="px-4 py-3">Prova</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-(--border-subtle) hover:bg-white/2">
                  <td className="px-4 py-3 text-foreground font-medium">{t.product_name}</td>
                  <td className="px-4 py-3 stat-value">
                    {(t.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: t.currency })}
                  </td>
                  <td className="px-4 py-3">{t.first_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{t.telegram_user_id ?? "—"}</td>
                  <td className="px-4 py-3 text-(--text-muted) text-xs">
                    {t.paid_at ? new Date(t.paid_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/dashboard/sales/${t.id}/proof`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-(--accent) hover:underline text-xs font-medium"
                    >
                      Ver prova ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
