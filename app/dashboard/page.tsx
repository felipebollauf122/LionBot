import { getTenantName, getActivityFeed, getDashboardDaily, getTopSellers } from "@/lib/actions/analytics-actions";
import { resolveViewScope, getViewableUsers } from "@/lib/actions/admin-actions";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

// Visibilidade do "Top 5 Players" (ranking de quem mais fatura no LionBot).
// Hoje: só admin. Pra religar pro PÚBLICO depois, troque para true.
const TOP_PLAYERS_PUBLIC = false;

function greeting(): string {
  // Hora em Brasília (UTC-3). A page roda no servidor (Vercel = UTC), então
  // new Date().getHours() daria a hora UTC e erraria a saudação por 3h.
  const h = new Date(Date.now() - 180 * 60_000).getUTCHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

type SP = { [key: string]: string | string[] | undefined };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const requestedView = typeof sp.view === "string" ? sp.view : undefined;

  // Resolve a visão de admin com SEGURANÇA (não-admin sempre vê só o próprio).
  const scope = await resolveViewScope(requestedView);

  // Carrega TUDO 1x (série diária pré-agregada). A troca de período é no cliente.
  const [name, daily, activity, users] = await Promise.all([
    getTenantName(),
    getDashboardDaily(scope.tenantId),
    getActivityFeed(12, scope.tenantId),
    scope.isAdmin ? getViewableUsers() : Promise.resolve([]),
  ]);

  // Top 5 Players (ranking global) só pra admin; independe do escopo de visão.
  const canSeeTopPlayers = TOP_PLAYERS_PUBLIC || scope.isAdmin;
  const topSellers = canSeeTopPlayers ? await getTopSellers(5) : [];

  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();

  return (
    <DashboardClient
      daily={daily}
      greeting={greeting()}
      name={name}
      todayLabel={today}
      activity={activity}
      topSellers={topSellers}
      showTopPlayers={canSeeTopPlayers}
      isAdmin={scope.isAdmin}
      viewUsers={users}
      currentView={requestedView ?? "mine"}
    />
  );
}
