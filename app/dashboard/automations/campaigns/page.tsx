import { AutomationRefresh } from "@/components/dashboard/automations/refresh";
import { MtprotoCampaignList } from "@/components/dashboard/mtproto-campaign-list";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  let query = context.supabase.from("mtproto_campaigns")
    .select("id, name, status, total_targets, sent_count, failed_count, created_at, recurrence_seconds, next_run_at")
    .order("created_at", { ascending: false });
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar disparos de mensagens.");
  return (
    <AutomationSectionPage title="Disparos de mensagens" description="Crie campanhas pelas contas conectadas e acompanhe os envios, as falhas e a recorrência." context={context}
      action={{ label: "Novo disparo", href: "/dashboard/automations/new-campaign" }}>
      <AutomationRefresh active={(data ?? []).some((row) => ["running", "waiting_flood", "ai_processing", "exploring", "building_flow", "listening_remarketing"].includes(row.status))} />
      <div className="card p-4 md:p-6">
        <MtprotoCampaignList campaigns={data ?? []} />
      </div>
    </AutomationSectionPage>
  );
}
