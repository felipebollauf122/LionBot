import { getOrphanedTransactions } from "@/lib/actions/orphaned-transactions-actions";

export default async function OrphanedTransactionsPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const { transactions, total } = await getOrphanedTransactions(botId);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-foreground mb-1">
        Pagou e não recebeu
      </h1>
      <p className="text-(--text-secondary) text-sm mb-6">
        {total === 0
          ? "Nenhuma transação órfã — todo pagamento aprovado teve entrega confirmada. ✅"
          : `${total} transação(ões) aprovada(s) sem confirmação de entrega. Investigue cada uma.`}
      </p>

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
