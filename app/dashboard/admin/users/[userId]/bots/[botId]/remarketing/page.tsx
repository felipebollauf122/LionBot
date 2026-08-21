import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/actions/admin-actions";
import { getOrCreateConfig, listFlows } from "@/lib/actions/remarketing-actions";
import { RemarketingDashboard } from "@/components/dashboard/remarketing-dashboard";
import type { RemarketingConfig, RemarketingFlow } from "@/lib/types/database";

export default async function AdminBotRemarketingPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { userId, botId } = await params;

  const config = (await getOrCreateConfig(botId)) as RemarketingConfig;
  const flows = (await listFlows(config.id)) as RemarketingFlow[];

  return (
    <div className="p-8">
      <RemarketingDashboard
        botId={botId}
        config={config}
        flows={flows}
        basePath={`/dashboard/admin/users/${userId}/bots/${botId}`}
      />
    </div>
  );
}
