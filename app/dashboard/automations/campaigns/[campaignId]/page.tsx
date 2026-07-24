import { createClient } from "@/lib/supabase/server";
import { MtprotoCampaignDetail } from "@/components/dashboard/mtproto-campaign-detail";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { campaignId } = await params;
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("mtproto_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (!campaign) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <a
        href="/dashboard/automations"
        className="text-(--text-muted) hover:text-foreground text-sm transition-colors"
      >
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
          Detalhe da campanha
        </h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Acompanhe o disparo em tempo real.
        </p>
      </header>
      <CardShell
        title={campaign.name}
        subtitle="disparo em massa"
        icon={icons.megaphone}
        accent="amber"
      >
        <MtprotoCampaignDetail initialCampaign={campaign} campaignId={campaignId} />
      </CardShell>
    </div>
  );
}
