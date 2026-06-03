import { getOrphanedTransactions } from "@/lib/actions/orphaned-transactions-actions";
import { OrphanedTransactionsView } from "@/components/dashboard/orphaned-transactions-view";

export default async function OrphanedTransactionsPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const { transactions, total } = await getOrphanedTransactions(botId);

  return (
    <div className="p-8 max-w-5xl">
      <OrphanedTransactionsView botId={botId} transactions={transactions} total={total} />
    </div>
  );
}
