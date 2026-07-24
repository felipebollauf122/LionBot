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

  const activeAccounts = (accounts ?? []).filter((a) => a.status === "active").length;
  const clonesCompleted = (clones ?? []).filter((c) => c.status === "completed").length;
  const clonesRunning = (clones ?? []).filter(
    (c) => c.status === "running" || c.status === "waiting_flood"
  ).length;

  return (
    <div className="p-8 max-w-5xl">
      <header className="mb-8 reveal">
        <h1 className="text-3xl font-bold text-(--text-primary) mb-1">Automações</h1>
        <p className="text-(--text-secondary)">
          Conecte contas pessoais do Telegram e dispare mensagens em massa.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10 reveal-1">
        <div className="card p-4">
          <div className="text-2xl font-bold text-(--text-primary)">{activeAccounts}</div>
          <div className="text-xs uppercase tracking-wide text-(--text-muted) mt-1">Contas ativas</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold text-(--text-primary)">{clonesCompleted}</div>
          <div className="text-xs uppercase tracking-wide text-(--text-muted) mt-1">Clones concluídos</div>
        </div>
        <div className="card p-4">
          <div className="text-2xl font-bold text-(--text-primary)">{clonesRunning}</div>
          <div className="text-xs uppercase tracking-wide text-(--text-muted) mt-1">Clones rodando</div>
        </div>
        <div className="card p-4">
          <div className="mb-1">
            {bot ? (
              <span className="badge badge-active">CONFIGURADO</span>
            ) : (
              <span className="badge badge-pending">PENDENTE</span>
            )}
          </div>
          <div className="text-xs uppercase tracking-wide text-(--text-muted) mt-1">Bot</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10 reveal-2">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-(--text-secondary) mb-3">
            Contas conectadas
          </h2>
          <MtprotoAccounts accounts={accounts ?? []} />
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-(--text-secondary) mb-3">
            Bot companheiro
          </h2>
          <AutomationBotCard bot={bot ?? null} />
        </section>
      </div>

      <section className="mb-12 reveal-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-(--text-secondary) mb-4">
          Clonagem
        </h2>
        <CloneList clones={clones ?? []} />
      </section>

      <section className="mb-10 reveal-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-(--text-secondary)">
            Campanhas
          </h2>
          <a href="/dashboard/automations/new-campaign" className="btn-primary">
            Nova campanha
          </a>
        </div>
        <MtprotoCampaignList campaigns={campaigns ?? []} />
      </section>

      <section className="reveal-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-(--text-secondary) mb-3">
          Monitoramento de canais
        </h2>
        <a
          href="/dashboard/automations/channel-monitors"
          className="card card-interactive block p-4"
        >
          <div className="text-(--text-primary) font-medium">🛡 Monitor + substituição automática</div>
          <div className="text-(--text-muted) text-xs mt-1">
            Quando um canal monitorado cair (canal banido ou conta freezada), o sistema cria automaticamente um canal substituto com o template configurado.
          </div>
        </a>
      </section>
    </div>
  );
}
