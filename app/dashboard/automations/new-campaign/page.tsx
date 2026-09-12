import { AutomationLink } from "@/components/dashboard/automations/scoped-link";
import { MtprotoCampaignForm } from "@/components/dashboard/mtproto-campaign-form";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import { AdminViewSwitcher } from "@/components/dashboard/admin-view-switcher";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

type SP = { [key: string]: string | string[] | undefined };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<SP> }) {
  const context = await getAutomationPageContext(searchParams);
  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <AutomationLink href="/dashboard/automations/campaigns" className="text-(--text-muted) hover:text-foreground text-sm transition-colors">
        ← Voltar
      </AutomationLink>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Nova campanha</h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Dispare mensagens pelas contas Telegram do usuário selecionado.
        </p>
        {context.scope.isAdmin && (
          <div className="mt-4">
            <AdminViewSwitcher users={context.users} currentView={context.view} />
          </div>
        )}
      </header>
      <CardShell
        title="Nova campanha"
        subtitle="Disparo MTProto"
        icon={icons.megaphone}
        accent="amber"
      >
        {context.canCreate && context.actingTenantId ? (
          <MtprotoCampaignForm actingTenantId={context.actingTenantId} />
        ) : (
          <p className="text-sm text-(--text-secondary)">Selecione um usuário para criar o disparo.</p>
        )}
      </CardShell>
    </div>
  );
}
