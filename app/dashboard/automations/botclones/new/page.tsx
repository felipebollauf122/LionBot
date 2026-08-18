import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { BotCloneForm } from "@/components/dashboard/bot-clone-form";
import { listDestBots, listEligibleBotCloneAccounts } from "@/app/dashboard/automations/botclones/actions";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function NewBotClonePage() {
  if (!(await isOwner())) notFound();

  const [destBots, accounts] = await Promise.all([
    listDestBots(),
    listEligibleBotCloneAccounts(),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <a href="/dashboard/automations" className="text-(--text-muted) hover:text-foreground text-sm transition-colors">
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Clonar bot</h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Reconstrói o fluxo de conversa de outro bot dentro de um dos seus.
        </p>
      </header>
      <CardShell title="Clonar" subtitle="fluxo de bot" icon={icons.flow} accent="magenta">
        <BotCloneForm
          destBots={destBots.map((b) => ({ id: b.id, label: `@${b.bot_username}` }))}
          accounts={accounts.map((a) => ({ id: a.id, label: a.display_name || a.phone_number }))}
        />
      </CardShell>
    </div>
  );
}
