import { AutomationRefresh } from "@/components/dashboard/automations/refresh";
import { ScheduledCampaignList } from "@/components/dashboard/campaigns/scheduled-campaign-list";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  let query = context.supabase.from("mtproto_scheduled_campaigns")
    .select("id, name, status, dest_title, total_messages, sent_count, failed_count, start_at")
    .order("created_at", { ascending: false });
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar postagens agendadas.");
  return (
    <AutomationSectionPage title="Campanhas manuais" description="Monte sua própria sequência de mensagens. Para importar e escutar canais, use Postagem automática." context={context}
      action={{ label: "Nova postagem agendada", href: "/dashboard/automations/scheduled/new" }}>
      <AutomationRefresh active={(data ?? []).some((row) => ["running", "waiting_flood", "ai_processing", "exploring", "building_flow", "listening_remarketing"].includes(row.status))} />
      <div className="card p-4 md:p-6">
        <ScheduledCampaignList campaigns={data ?? []} />
      </div>
    </AutomationSectionPage>
  );
}
