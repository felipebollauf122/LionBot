import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { FlowEditor } from "@/components/dashboard/flow-builder/flow-editor";
import { getEnabledGatewaysForBot } from "@/lib/actions/bot-gateways";
import type { Flow } from "@/lib/types/database";

export default async function FlowEditorPage({
  params,
}: {
  params: Promise<{ botId: string; flowId: string }>;
}) {
  const { botId, flowId } = await params;
  const supabase = await createClient();

  const [{ data: flow }, { data: bundles }, { data: products }, enabledGateways] = await Promise.all([
    supabase
      .from("flows")
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
    getEnabledGatewaysForBot(botId),
  ]);

  if (!flow) notFound();

  const typedFlow = flow as Flow;

  return (
    <FlowEditor
      flowId={typedFlow.id}
      flowName={typedFlow.name}
      initialData={typedFlow.flow_data}
      botId={botId}
      bundles={(bundles ?? []) as { id: string; name: string }[]}
      products={(products ?? []) as { id: string; name: string; price: number; currency: string }[]}
      enabledGateways={enabledGateways}
    />
  );
}
