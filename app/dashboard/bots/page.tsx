import { getBotsFleet } from "@/lib/actions/analytics-actions";
import { BotsFleet } from "@/components/dashboard/bots-fleet";

export const dynamic = "force-dynamic";

export default async function BotsPage() {
  const bots = await getBotsFleet();
  return <BotsFleet bots={bots} />;
}
