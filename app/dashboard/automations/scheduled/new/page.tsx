import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { NewScheduledCampaignForm } from "@/components/dashboard/campaigns/new-campaign-form";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function NewScheduledCampaignPage({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  return (
    <AutomationSectionPage title="Nova postagem agendada" description="Dê um nome à campanha para organizar sua sequência de conteúdo." context={context}>
      {context.canCreate && context.actingTenantId ? (
        <NewScheduledCampaignForm actingTenantId={context.actingTenantId} view={context.view} />
      ) : (
        <p className="text-sm text-(--text-secondary)">Escolha um usuário no seletor acima para continuar.</p>
      )}
    </AutomationSectionPage>
  );
}
