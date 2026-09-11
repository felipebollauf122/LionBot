import { AutomationRefresh } from "@/components/dashboard/automations/refresh";
import { CloneList } from "@/components/dashboard/clone-list";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  let query = context.supabase.from("clone_jobs")
    .select("id, dest_title, source_title, status, copied_count, total_seen")
    .order("created_at", { ascending: false });
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar clonar canais e grupos.");
  return (
    <AutomationSectionPage title="Clonar canais e grupos" description="Acompanhe suas cópias ou escolha um canal de origem para começar. O modo rascunho permite revisar o conteúdo antes de publicar." context={context}
      action={{ label: "Escolher canal de origem", href: "/dashboard/automations/clones/new" }}>
      <AutomationRefresh active={(data ?? []).some((row) => ["running", "waiting_flood", "ai_processing", "exploring", "building_flow", "listening_remarketing"].includes(row.status))} />
      <div className="card p-4 md:p-6">
        <CloneList clones={data ?? []} />
      </div>
    </AutomationSectionPage>
  );
}
