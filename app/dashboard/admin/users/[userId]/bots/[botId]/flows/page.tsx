import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { FlowList } from "@/components/dashboard/flow-list";
import type { Flow } from "@/lib/types/database";

export default async function AdminBotFlowsPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { userId, botId } = await params;
  const supabase = await createClient();

  const [{ data: flows }, { data: bot }] = await Promise.all([
    supabase
      .from("flows")
      .select("*")
      .eq("bot_id", botId)
      .order("created_at", { ascending: false }),
    supabase
      .from("bots")
      .select("id, black_enabled")
      .eq("id", botId)
      .single(),
  ]);

  const allFlows = (flows ?? []) as Flow[];
  const visualFlow = allFlows.find((f) => f.name === "_visual_flow") ?? null;
  const blackFlow = allFlows.find((f) => f.name === "_black_flow") ?? null;
  const otherFlows = allFlows.filter((f) => f.name !== "_visual_flow" && f.name !== "_black_flow");

  return (
    <FlowList
      flows={otherFlows}
      visualFlow={visualFlow}
      blackFlow={blackFlow}
      botId={botId}
      blackEnabled={bot?.black_enabled ?? false}
      basePath={`/dashboard/admin/users/${userId}/bots/${botId}`}
    />
  );
}
