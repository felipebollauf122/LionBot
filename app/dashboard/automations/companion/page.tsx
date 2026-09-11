import { AutomationBotCard } from "@/components/dashboard/automation-bot-card";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function CompanionPage({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  let query = context.supabase.from("automation_bots").select("username, bot_user_id, tenant_id").order("username");
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar os bots de publicação.");
  return (
    <AutomationSectionPage title="Bot de publicação" description="Este bot publica os clones e as postagens agendadas nos canais de destino." context={context}>
      <div className="card max-w-3xl p-4 md:p-6">
        {data?.length ? (
          <div className="space-y-4">{data.map((bot) => (
            <AutomationBotCard key={bot.tenant_id} bot={bot} />
          ))}</div>
        ) : (
          <AutomationBotCard bot={null} createTenantId={context.canCreate ? context.actingTenantId : undefined} />
        )}
      </div>
    </AutomationSectionPage>
  );
}
