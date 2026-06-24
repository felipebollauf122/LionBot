import { getTenantName, getActivityFeed, getDashboardDaily, getTopSellers } from "@/lib/actions/analytics-actions";
import { isAdmin } from "@/lib/actions/admin-actions";
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

export default async function DashboardPage() {
  // Carrega TUDO 1x (série diária pré-agregada — payload pequeno). A troca de
  // período é feita no cliente, instantânea, sem novo round-trip.
  const [name, daily, activity, admin] = await Promise.all([
    getTenantName(),
    getDashboardDaily(),
    getActivityFeed(12),
    isAdmin(),
  ]);

  // Top 5 Players: visível só pra admin (ou pra todos, se TOP_PLAYERS_PUBLIC).
  // Só roda a query (pesada, service-role) quando vai realmente mostrar.
  const canSeeTopPlayers = TOP_PLAYERS_PUBLIC || admin;
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
    />
  );
}
