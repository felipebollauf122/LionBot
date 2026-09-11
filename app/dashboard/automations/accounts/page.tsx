import { MtprotoAccounts } from "@/components/dashboard/mtproto-accounts";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  let query = context.supabase.from("mtproto_accounts")
    .select("id, phone_number, display_name, status, last_error, create_restricted")
    .order("created_at", { ascending: false });
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar contas telegram.");
  return (
    <AutomationSectionPage title="Contas Telegram" description="Conecte uma conta para acessar conversas, sincronizar canais e escolher conteúdo para clonar." context={context}>
      <div className="card p-4 md:p-6">
        <MtprotoAccounts accounts={data ?? []} actingTenantId={context.canCreate ? context.actingTenantId : undefined} />
      </div>
    </AutomationSectionPage>
  );
}
