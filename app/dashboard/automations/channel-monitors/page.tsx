import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { notFound } from "next/navigation";
import { listChannelTemplates, listChannelMonitors } from "./actions";
import { listActiveAccounts } from "@/app/dashboard/automations/actions";
import { ChannelMonitorsPanel } from "@/components/dashboard/channel-monitors-panel";

export default async function ChannelMonitorsPage() {
  if (!(await canAccessAutomations())) notFound();

  const [templates, monitors, accounts] = await Promise.all([
    listChannelTemplates(),
    listChannelMonitors(),
    listActiveAccounts(),
  ]);

  return (
    <div className="p-8 max-w-5xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4 mb-1">
        Monitor de canais
      </h1>
      <p className="text-white/50 text-sm mb-8 max-w-2xl leading-relaxed">
        Quando um canal monitorado for derrubado (canal banido ou conta dona freezada),
        outra conta MTProto ativa cria automaticamente um canal substituto com o
        template configurado abaixo (mídias + textos). O link de convite fica
        disponível pra você divulgar.
      </p>

      <ChannelMonitorsPanel
        initialTemplates={templates}
        initialMonitors={monitors}
        accounts={accounts}
      />
    </div>
  );
}
