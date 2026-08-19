import { createClient } from "@/lib/supabase/server";
import { MtprotoAccounts } from "@/components/dashboard/mtproto-accounts";
import { MtprotoCampaignList } from "@/components/dashboard/mtproto-campaign-list";
import { AutomationBotCard } from "@/components/dashboard/automation-bot-card";
import { CloneList } from "@/components/dashboard/clone-list";
import { BotCloneList } from "@/components/dashboard/bot-clone-list";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { notFound } from "next/navigation";

export default async function AutomationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await canAccessAutomations())) notFound();

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

  const { data: botClones } = await supabase
    .from("bot_clone_jobs")
    .select("id, target_bot_username, status, nodes_discovered")
    .eq("tenant_id", user.id)
    .order("created_at", { ascending: false });

  const activeAccounts = (accounts ?? []).filter((a) => a.status === "active").length;
  const clonesCompleted = (clones ?? []).filter((c) => c.status === "completed").length;
  const clonesRunning = (clones ?? []).filter(
    (c) => c.status === "running" || c.status === "waiting_flood",
  ).length;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <header className="mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Automações</h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Conecte contas do Telegram, clone canais e dispare mensagens em massa.
        </p>
      </header>

      {/* Faixa de KPIs — mesmos cards do dashboard (KpiCard), herdam o tema */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Contas ativas"
          value=""
          numericValue={activeAccounts}
          format="int"
          hint={`${(accounts ?? []).length} conectada${(accounts ?? []).length !== 1 ? "s" : ""}`}
          accent="purple"
          icon={icons.users}
          revealIndex={1}
        />
        <KpiCard
          label="Clones rodando"
          value=""
          numericValue={clonesRunning}
          format="int"
          hint={clonesRunning > 0 ? "em andamento" : "nenhum agora"}
          accent="cyan"
          icon={icons.repeat}
          revealIndex={2}
        />
        <KpiCard
          label="Clones concluídos"
          value=""
          numericValue={clonesCompleted}
          format="int"
          hint={`${(clones ?? []).length} no total`}
          accent="magenta"
          icon={icons.check}
          revealIndex={3}
        />
        <KpiCard
          label="Bot companheiro"
          value={bot ? "Ativo" : "Pendente"}
          hint={bot ? `@${bot.username}` : "cadastre o token"}
          accent="amber"
          icon={icons.bot}
          revealIndex={4}
        />
      </div>

      {/* Contas conectadas — largura cheia */}
      <div className="mb-6">
        <CardShell
          title="Contas conectadas"
          subtitle="perfis do Telegram"
          icon={icons.users}
          accent="purple"
          revealIndex={2}
        >
          <MtprotoAccounts accounts={accounts ?? []} />
        </CardShell>
      </div>

      {/* Bot companheiro — largura cheia (é menor) */}
      <div className="mb-6">
        <CardShell
          title="Bot companheiro"
          subtitle="publica os clones"
          icon={icons.bot}
          accent="cyan"
          revealIndex={3}
        >
          <AutomationBotCard bot={bot ?? null} />
        </CardShell>
      </div>

      {/* Clonagem */}
      <div className="mb-6">
        <CardShell
          title="Clonagem"
          subtitle="clone canais e grupos"
          icon={icons.flow}
          accent="magenta"
          revealIndex={4}
        >
          <CloneList clones={clones ?? []} />
        </CardShell>
      </div>

      {/* Clonar bot (fluxo) */}
      <div className="mb-6">
        <CardShell
          title="Clonar bot (fluxo)"
          subtitle="clone a conversa de outro bot"
          icon={icons.flow}
          accent="purple"
          revealIndex={5}
          right={
            <a href="/dashboard/automations/botclones/new" className="btn-primary text-xs px-4 py-2">
              Novo
            </a>
          }
        >
          <BotCloneList clones={botClones ?? []} />
        </CardShell>
      </div>

      {/* Campanhas */}
      <div className="mb-6">
        <CardShell
          title="Campanhas"
          subtitle="disparo em massa"
          icon={icons.megaphone}
          accent="amber"
          revealIndex={6}
          right={
            <a href="/dashboard/automations/new-campaign" className="btn-primary text-xs px-4 py-2">
              Nova campanha
            </a>
          }
        >
          <MtprotoCampaignList campaigns={campaigns ?? []} />
        </CardShell>
      </div>

    </div>
  );
}
