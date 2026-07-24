import { createClient } from "@/lib/supabase/server";
import { MtprotoAccounts } from "@/components/dashboard/mtproto-accounts";
import { MtprotoCampaignList } from "@/components/dashboard/mtproto-campaign-list";
import { AutomationBotCard } from "@/components/dashboard/automation-bot-card";
import { CloneList } from "@/components/dashboard/clone-list";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";
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

      {/* Clonagem — seção-herói */}
      <div className="mb-6">
        <CardShell
          title="Clonagem"
          subtitle="clone canais e grupos"
          icon={icons.flow}
          accent="magenta"
          revealIndex={2}
        >
          <CloneList clones={clones ?? []} />
        </CardShell>
      </div>

      {/* Contas + Bot lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <CardShell
          title="Contas conectadas"
          subtitle="perfis do Telegram"
          icon={icons.users}
          accent="purple"
          revealIndex={3}
        >
          <MtprotoAccounts accounts={accounts ?? []} />
        </CardShell>

        <CardShell
          title="Bot companheiro"
          subtitle="publica os clones"
          icon={icons.bot}
          accent="cyan"
          revealIndex={4}
        >
          <AutomationBotCard bot={bot ?? null} />
        </CardShell>
      </div>

      {/* Campanhas */}
      <div className="mb-6">
        <CardShell
          title="Campanhas"
          subtitle="disparo em massa"
          icon={icons.megaphone}
          accent="amber"
          revealIndex={5}
          right={
            <a href="/dashboard/automations/new-campaign" className="btn-primary text-xs px-4 py-2">
              Nova campanha
            </a>
          }
        >
          <MtprotoCampaignList campaigns={campaigns ?? []} />
        </CardShell>
      </div>

      {/* Monitoramento */}
      <CardShell
        title="Monitoramento de canais"
        subtitle="substituição automática"
        icon={icons.eye}
        accent="cyan"
        revealIndex={6}
      >
        <a
          href="/dashboard/automations/channel-monitors"
          className="row-hover reveal flex items-center gap-3 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
        >
          <div className="min-w-0">
            <div className="text-foreground text-sm font-medium">🛡 Monitor + substituição automática</div>
            <div className="text-(--text-muted) text-xs mt-0.5">
              Quando um canal monitorado cai (banido ou conta freezada), o sistema cria um substituto
              automaticamente com o template configurado.
            </div>
          </div>
        </a>
      </CardShell>
    </div>
  );
}
