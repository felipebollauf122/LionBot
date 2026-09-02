import { getSocialProof } from "@/lib/actions/social-proof-actions";
import { SocialProofComposer } from "@/components/dashboard/social-proof/composer";

export default async function ProvaSocialPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const { channel, messages } = await getSocialProof(botId);

  return <SocialProofComposer botId={botId} channel={channel} messages={messages} />;
}
