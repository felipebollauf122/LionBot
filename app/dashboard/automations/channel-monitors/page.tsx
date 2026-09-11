import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { notFound } from "next/navigation";
import { listChannelTemplates, listChannelMonitors } from "./actions";
import { listActiveAccounts } from "@/app/dashboard/automations/actions";
import { ChannelMonitorsPanel } from "@/components/dashboard/channel-monitors-panel";

export default async function ChannelMonitorsPage() {
  if (!(await canAccessAutomations())) notFound();
  const [templates, monitors, accounts] = await Promise.all([
    listChannelTemplates(), listChannelMonitors(), listActiveAccounts(),
  ]);
  return (
    <section className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Monitoramento de canais</h1>
        <p className="mt-2 text-sm leading-relaxed text-(--text-secondary)">Monitore os canais da sua conta. Se um canal cair, uma conta ativa pode criar um substituto com o conteúdo do modelo escolhido.</p>
      </header>
      <ChannelMonitorsPanel initialTemplates={templates} initialMonitors={monitors} accounts={accounts} />
    </section>
  );
}
