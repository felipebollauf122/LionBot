import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { FlowEditor } from "@/components/dashboard/flow-builder/flow-editor";
import type { Flow } from "@/lib/types/database";

export default async function AdminBotFlowEditorPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string; flowId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { userId, botId, flowId } = await params;
  const supabase = await createClient();

  const [{ data: flow }, { data: bundles }, { data: products }] = await Promise.all([
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
      backUrl={`/dashboard/admin/users/${userId}/bots/${botId}/flows`}
    />
  );
}
