import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { CloneForm } from "@/components/dashboard/clone-form";
import { listEligibleDestAccounts } from "@/app/dashboard/automations/clones/actions";
import { listDestinationDialogs } from "@/app/dashboard/automations/scheduled/actions";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";
import Link from "next/link";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import { automationHref } from "@/lib/automations/navigation";

export default async function NewClonePage({
  searchParams,
}: {
  searchParams: Promise<{ dialogId?: string; view?: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { dialogId, view } = await searchParams;
  if (!dialogId) {
    const context = await getAutomationPageContext(searchParams);
    let query = context.supabase.from("mtproto_accounts")
      .select("id, display_name, phone_number")
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
    const { data: accounts, error } = await query;
    if (error) throw new Error("Não foi possível carregar as contas.");
    return (
      <AutomationSectionPage title="Escolha a origem do clone" description="Abra uma conta para escolher o canal ou grupo que deseja copiar." context={context}>
        {accounts?.length ? (
          <div className="card max-w-3xl divide-y divide-(--border-default) px-5">
            {accounts.map((account) => (
              <Link key={account.id} href={context.href(`/dashboard/automations/accounts/${account.id}/dialogs`)} className="flex flex-wrap items-center justify-between gap-3 py-5 text-sm text-foreground hover:text-(--accent)">
                <span>{account.display_name || account.phone_number}</span>
                <span className="text-(--text-secondary)">Escolher canal ou grupo</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card max-w-2xl space-y-4 p-6">
            <p className="text-sm text-(--text-secondary)">Conecte uma conta do Telegram e sincronize seu conteúdo para escolher a origem.</p>
            <Link href={context.href("/dashboard/automations/accounts")} className="btn-primary">Conectar conta Telegram</Link>
          </div>
        )}
      </AutomationSectionPage>
    );
  }

  const supabase = await createClient();
  // resolveActingTenantId reconfere admin no server — ?view= de um não-admin é ignorado.
  const actingTenantId = await resolveActingTenantId(view);

  const { data: dialog } = await supabase
    .from("mtproto_dialogs")
    .select("id, title, kind, account_id, mtproto_accounts!inner(tenant_id)")
    .eq("id", dialogId)
    .eq("mtproto_accounts.tenant_id", actingTenantId)
    .single();
  if (!dialog) notFound();

  // Contas que podem CRIAR o destino: ativas e não-restritas. A conta da
  // origem entra na lista só se ela mesma puder criar (não estiver restrita).
  // Reusa a mesma action que valida a fonte da verdade, sem duplicar a query.
  const eligible = await listEligibleDestAccounts(actingTenantId);

  // Canais onde o rascunho pode publicar depois. É a MESMA lista da tela da
  // campanha (mesma action, mesmo filtro: canal/supergrupo com uma conta do
  // tenant como admin), e ela varre TODAS as contas — é o que mantém "clonar
  // de uma conta pra outra" possível também no modo rascunho.
  const destDialogs = await listDestinationDialogs(actingTenantId);

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <Link href={automationHref("/dashboard/automations/clones", view)} className="text-(--text-muted) hover:text-foreground text-sm transition-colors">
        Voltar para clonagem de canais
      </Link>
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
          destDialogs={destDialogs}
          actingTenantId={actingTenantId}
        />
      </CardShell>
    </div>
  );
}
