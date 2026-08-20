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
import { resolveViewScope, getViewableUsers } from "@/lib/actions/admin-actions";
import { AdminViewSwitcher } from "@/components/dashboard/admin-view-switcher";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type SP = { [key: string]: string | string[] | undefined };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await canAccessAutomations())) notFound();

  const sp = await searchParams;
  const requestedView = typeof sp.view === "string" ? sp.view : undefined;
  // Visão de admin (Minha/Todos/Por usuário) — mesmo seletor do /dashboard e /dashboard/bots.
  const scope = await resolveViewScope(requestedView);
  const viewTenantId = scope.tenantId;

  let accountsQuery = supabase
    .from("mtproto_accounts")
    .select("id, phone_number, display_name, status, last_error, create_restricted")
    .order("created_at", { ascending: false });
  if (viewTenantId) accountsQuery = accountsQuery.eq("tenant_id", viewTenantId);

  let campaignsQuery = supabase
    .from("mtproto_campaigns")
    .select("id, name, status, total_targets, sent_count, failed_count, created_at, recurrence_hours, next_run_at")
    .order("created_at", { ascending: false });
  if (viewTenantId) campaignsQuery = campaignsQuery.eq("tenant_id", viewTenantId);

  // .limit(1) em vez de .maybeSingle(): no modo "Todos" (viewTenantId null) pode
  // haver 1 automation_bot por tenant, e maybeSingle() lança erro se vier >1 linha.
  let botQuery = supabase.from("automation_bots").select("username, bot_user_id").limit(1);
  if (viewTenantId) botQuery = botQuery.eq("tenant_id", viewTenantId);

  let clonesQuery = supabase
    .from("clone_jobs")
    .select("id, dest_title, source_title, status, copied_count, total_seen")
    .order("created_at", { ascending: false });
  if (viewTenantId) clonesQuery = clonesQuery.eq("tenant_id", viewTenantId);

  let botClonesQuery = supabase
    .from("bot_clone_jobs")
    .select("id, target_bot_username, status, nodes_discovered")
    .order("created_at", { ascending: false });
  if (viewTenantId) botClonesQuery = botClonesQuery.eq("tenant_id", viewTenantId);

  const [{ data: accounts }, { data: campaigns }, { data: botRows }, { data: clones }, { data: botClones }, viewUsers] = await Promise.all([
    accountsQuery,
    campaignsQuery,
    botQuery,
    clonesQuery,
    botClonesQuery,
    scope.isAdmin ? getViewableUsers() : Promise.resolve([]),
  ]);
  const bot = (botRows ?? [])[0] ?? null;

  // Ações de escrita (sincronizar, remover, criar campanha/clone...) usam a sessão
  // do admin (currentTenantId()), não o tenant selecionado — então em "Todos"/outro
  // usuário a UI vira só-leitura pra evitar 404/erro ao clicar e pra não disparar
  // ações acidentalmente na conta de outro usuário.
  const readOnly = scope.mode !== "mine";

  const activeAccounts = (accounts ?? []).filter((a) => a.status === "active").length;
  const clonesCompleted = (clones ?? []).filter((c) => c.status === "completed").length;
  const clonesRunning = (clones ?? []).filter(
    (c) => c.status === "running" || c.status === "waiting_flood",
  ).length;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <header className="mb-6 reveal flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">Automações</h1>
          <p className="text-(--text-secondary) text-sm mt-1">
            Conecte contas do Telegram, clone canais e dispare mensagens em massa.
          </p>
        </div>
        {scope.isAdmin && (
          <div className="flex flex-col items-end gap-1.5">
            <AdminViewSwitcher users={viewUsers} currentView={requestedView ?? "mine"} />
            {readOnly && (
              <span className="text-(--text-muted) text-[11px]">
                Visão somente leitura — ações ficam disponíveis em &quot;Minha&quot;
              </span>
            )}
          </div>
        )}
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
          <MtprotoAccounts accounts={accounts ?? []} readOnly={readOnly} />
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
          <AutomationBotCard bot={bot ?? null} readOnly={readOnly} />
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
          <CloneList clones={clones ?? []} readOnly={readOnly} />
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
            !readOnly && (
              <a href="/dashboard/automations/botclones/new" className="btn-primary text-xs px-4 py-2">
                Novo
              </a>
            )
          }
        >
          <BotCloneList clones={botClones ?? []} readOnly={readOnly} />
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
            !readOnly && (
              <a href="/dashboard/automations/new-campaign" className="btn-primary text-xs px-4 py-2">
                Nova campanha
              </a>
            )
          }
        >
          <MtprotoCampaignList campaigns={campaigns ?? []} readOnly={readOnly} />
        </CardShell>
      </div>

    </div>
  );
}
