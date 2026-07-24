import { createClient } from "@/lib/supabase/server";
import { MtprotoAccounts } from "@/components/dashboard/mtproto-accounts";
import { MtprotoCampaignList } from "@/components/dashboard/mtproto-campaign-list";
import { AutomationBotCard } from "@/components/dashboard/automation-bot-card";
import { CloneList } from "@/components/dashboard/clone-list";
import { isOwner } from "@/lib/actions/owner-actions";
import { notFound } from "next/navigation";

export default async function AutomationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await isOwner())) notFound();

  const { data: accounts } = await supabase
    .from("mtproto_accounts")
    .select("id, phone_number, display_name, status, last_error, create_restricted")
    .eq("tenant_id", user.id)
    .order("created_at", { ascending: false });

  const { data: campaigns } = await supabase
    .from("mtproto_campaigns")
    .select("id, name, status, total_targets, sent_count, failed_count, created_at, recurrence_hours, next_run_at")
    .eq("tenant_id", user.id)
    .order("created_at", { ascending: false });

  const { data: bot } = await supabase
    .from("automation_bots")
    .select("username, bot_user_id")
    .eq("tenant_id", user.id)
    .maybeSingle();

  const { data: clones } = await supabase
    .from("clone_jobs")
    .select("id, dest_title, source_title, status, copied_count, total_seen")
    .eq("tenant_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-white mb-1">Automações</h1>
      <p className="text-white/50 mb-8">
        Conecte contas pessoais do Telegram e dispare mensagens em massa.
      </p>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Contas conectadas</h2>
        <MtprotoAccounts accounts={accounts ?? []} />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Bot companheiro</h2>
        <AutomationBotCard bot={bot ?? null} />
      </section>

      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Campanhas</h2>
          <a
            href="/dashboard/automations/new-campaign"
            className="px-3 py-1.5 rounded-md bg-(--accent) text-black text-sm font-medium hover:opacity-90"
          >
            Nova campanha
          </a>
        </div>
        <MtprotoCampaignList campaigns={campaigns ?? []} />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Clonagem</h2>
        <CloneList clones={clones ?? []} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Monitoramento de canais</h2>
        <a
          href="/dashboard/automations/channel-monitors"
          className="block p-4 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
        >
          <div className="text-white font-medium">🛡 Monitor + substituição automática</div>
          <div className="text-white/50 text-xs mt-1">
            Quando um canal monitorado cair (canal banido ou conta freezada), o sistema cria automaticamente um canal substituto com o template configurado.
          </div>
        </a>
      </section>
    </div>
  );
}
