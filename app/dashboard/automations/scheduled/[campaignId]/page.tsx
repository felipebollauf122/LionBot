import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { getScheduledCampaign } from "../actions";
import { CampaignComposer } from "@/components/dashboard/campaigns/campaign-composer";

export const dynamic = "force-dynamic";

export default async function ScheduledCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { campaignId } = await params;
  const { campaign, messages } = await getScheduledCampaign(campaignId);
  if (!campaign) notFound();

  return <CampaignComposer campaign={campaign} messages={messages} />;
}
