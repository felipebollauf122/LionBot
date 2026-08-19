import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { CloneForm } from "@/components/dashboard/clone-form";
import { listEligibleDestAccounts } from "@/app/dashboard/automations/clones/actions";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function NewClonePage({
  searchParams,
}: {
  searchParams: Promise<{ dialogId?: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { dialogId } = await searchParams;
  if (!dialogId) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: dialog } = await supabase
    .from("mtproto_dialogs")
    .select("id, title, kind, account_id, mtproto_accounts!inner(tenant_id)")
    .eq("id", dialogId)
    .eq("mtproto_accounts.tenant_id", user.id)
    .single();
  if (!dialog) notFound();

  // Contas que podem CRIAR o destino: ativas e não-restritas. A conta da
  // origem entra na lista só se ela mesma puder criar (não estiver restrita).
  // Reusa a mesma action que valida a fonte da verdade, sem duplicar a query.
  const eligible = await listEligibleDestAccounts();

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <a href="/dashboard/automations" className="text-(--text-muted) hover:text-foreground text-sm transition-colors">
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Novo clone</h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Cria uma cópia da origem numa conta que você escolher.
        </p>
      </header>
      <CardShell
        title="Clonar"
        subtitle={dialog.title ?? undefined}
        icon={icons.flow}
        accent="magenta"
      >
        <CloneForm
          dialogId={dialog.id}
          sourceTitle={dialog.title ?? "Clone"}
          sourceAccountId={dialog.account_id}
          destAccounts={(eligible ?? []).map((a) => ({
            id: a.id,
            label: a.display_name || a.phone_number,
          }))}
        />
      </CardShell>
    </div>
  );
}
