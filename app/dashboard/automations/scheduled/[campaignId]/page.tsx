import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { getScheduledCampaign } from "../actions";
import { CampaignComposer } from "@/components/dashboard/campaigns/campaign-composer";
import { automationHref, type AutomationSearchParams } from "@/lib/automations/navigation";
import { createClient } from "@/lib/supabase/server";
import { AutomationRefresh } from "@/components/dashboard/automations/refresh";

export const dynamic = "force-dynamic";

export default async function ScheduledCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<AutomationSearchParams>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { campaignId } = await params;
  const { campaign, messages } = await getScheduledCampaign(campaignId);
  if (!campaign) notFound();

  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : undefined;
  const supabase = await createClient();
  const { data: sourceClone, error } = campaign.source_clone_job_id
    ? await supabase.from("clone_jobs").select("id, status, copied_count, last_error").eq("id", campaign.source_clone_job_id).maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error("Não foi possível consultar a importação.");
  const importing = !!sourceClone && ["draft", "running", "waiting_flood"].includes(sourceClone.status);
  return <>
    <AutomationRefresh active={importing || campaign.status === "running" || campaign.status === "ai_processing"} />
    <CampaignComposer campaign={campaign} messages={messages} sourceClone={sourceClone} returnHref={automationHref("/dashboard/automations/scheduled/campaigns", view)} />
  </>;
}
