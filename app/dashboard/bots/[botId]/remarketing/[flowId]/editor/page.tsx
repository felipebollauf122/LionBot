import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { FlowEditor } from "@/components/dashboard/flow-builder/flow-editor";
import { saveRemarketingFlowData } from "@/lib/actions/remarketing-actions";
import { listMediaAssets } from "@/lib/actions/media-actions";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import type { RemarketingFlow } from "@/lib/types/database";

export default async function RemarketingFlowEditorPage({
  params,
}: {
  params: Promise<{ botId: string; flowId: string }>;
}) {
  const { botId, flowId } = await params;
  const supabase = await createClient();

  const [{ data: flow }, { data: bundles }, { data: products }, mediaAssets, canRandomize] = await Promise.all([
    supabase
      .from("remarketing_flows")
      .select("*")
      .eq("id", flowId)
      .eq("bot_id", botId)
      .single(),
    supabase
      .from("product_bundles")
      .select("id, name, is_active")
      .eq("bot_id", botId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("products")
      .select("id, name, price, currency")
      .eq("bot_id", botId)
      .eq("is_active", true)
      .order("name"),
    listMediaAssets(botId),
    canAccessAutomations(),
  ]);

  if (!flow) notFound();

  const typedFlow = flow as RemarketingFlow;

  return (
    <FlowEditor
      flowId={typedFlow.id}
      flowName={typedFlow.name}
      initialData={typedFlow.flow_data}
      botId={botId}
      bundles={(bundles ?? []) as { id: string; name: string }[]}
      products={(products ?? []) as { id: string; name: string; price: number; currency: string }[]}
      mediaAssets={mediaAssets}
      canRandomize={canRandomize}
      saveAction={saveRemarketingFlowData}
      backUrl={`/dashboard/bots/${botId}/remarketing`}
    />
  );
}
