import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { TrafficFilterManager } from "@/components/dashboard/traffic-filter-manager";
import type { TrafficFilterRule } from "@/lib/types/database";

export default async function AdminBotTrafficFilterPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { botId } = await params;
  const supabase = await createClient();

  const { data: bot } = await supabase
    .from("bots")
    .select("id, tenant_id, traffic_filter_enabled")
    .eq("id", botId)
    .single();
  if (!bot) redirect("/dashboard");

  const { data: rules } = await supabase
    .from("traffic_filter_rules")
    .select("*")
    .eq("tenant_id", bot.tenant_id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <TrafficFilterManager
        botId={bot.id}
        tenantId={bot.tenant_id as string}
        trafficFilterEnabled={!!bot.traffic_filter_enabled}
        initialRules={(rules ?? []) as TrafficFilterRule[]}
      />
    </div>
  );
}
