import { MtprotoCampaignForm } from "@/components/dashboard/mtproto-campaign-form";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { notFound } from "next/navigation";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function NewCampaignPage() {
  if (!(await canAccessAutomations())) notFound();
  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <a href="/dashboard/automations" className="text-(--text-muted) hover:text-foreground text-sm transition-colors">
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Nova campanha</h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Dispare mensagens em massa pelas suas contas MTProto conectadas.
        </p>
      </header>
      <CardShell
        title="Nova campanha"
        subtitle="Disparo MTProto"
        icon={icons.megaphone}
        accent="amber"
      >
        <MtprotoCampaignForm />
      </CardShell>
    </div>
  );
}
