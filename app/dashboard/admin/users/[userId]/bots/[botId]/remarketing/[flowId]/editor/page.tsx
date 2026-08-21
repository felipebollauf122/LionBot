import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { FlowEditor } from "@/components/dashboard/flow-builder/flow-editor";
import { saveRemarketingFlowData } from "@/lib/actions/remarketing-actions";
import { listMediaAssets } from "@/lib/actions/media-actions";
import type { RemarketingFlow } from "@/lib/types/database";

export default async function AdminBotRemarketingFlowEditorPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string; flowId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { userId, botId, flowId } = await params;
  const supabase = await createClient();

  const [{ data: flow }, { data: bundles }, { data: products }, mediaAssets, { data: targetTenant }] =
    await Promise.all([
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
      // canAccessAutomations() checaria o tenant do ADMIN logado — aqui a
      // checagem precisa ser sobre o `userId` impersonado (dono do fluxo),
      // senão o painel esconde variações/randomização já configuradas pelo
      // dono e o admin acaba editando um campo que a engine não lê em runtime.
      supabase.from("tenants").select("is_owner, is_premium").eq("id", userId).single(),
    ]);

  if (!flow) notFound();

  const typedFlow = flow as RemarketingFlow;
  const canRandomize = targetTenant?.is_owner === true || targetTenant?.is_premium === true;

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
      backUrl={`/dashboard/admin/users/${userId}/bots/${botId}/remarketing`}
    />
  );
}
