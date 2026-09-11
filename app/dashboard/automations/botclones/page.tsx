import { AutomationRefresh } from "@/components/dashboard/automations/refresh";
import { BotCloneList } from "@/components/dashboard/bot-clone-list";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  let query = context.supabase.from("bot_clone_jobs")
    .select("id, target_bot_username, status, nodes_discovered")
    .order("created_at", { ascending: false });
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar clonar bots.");
  return (
    <AutomationSectionPage title="Clonar bots" description="Copie a estrutura de conversa de um bot para um dos seus bots e acompanhe a descoberta do fluxo." context={context}
      action={{ label: "Nova clonagem de bot", href: "/dashboard/automations/botclones/new" }}>
      <AutomationRefresh active={(data ?? []).some((row) => ["running", "waiting_flood", "ai_processing", "exploring", "building_flow", "listening_remarketing"].includes(row.status))} />
      <div className="card p-4 md:p-6">
        <BotCloneList clones={data ?? []} />
      </div>
    </AutomationSectionPage>
  );
}
