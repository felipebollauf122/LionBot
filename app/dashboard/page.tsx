import { getTenantName, getActivityFeed, getDashboardDaily, getTopSellers } from "@/lib/actions/analytics-actions";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default async function DashboardPage() {
  // Carrega TUDO 1x (série diária pré-agregada — payload pequeno). A troca de
  // período é feita no cliente, instantânea, sem novo round-trip.
  const [name, daily, activity, topSellers] = await Promise.all([
    getTenantName(),
    getDashboardDaily(),
    getActivityFeed(12),
    getTopSellers(5),
  ]);

  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();

  return (
    <DashboardClient daily={daily} greeting={greeting()} name={name} todayLabel={today} activity={activity} topSellers={topSellers} />
  );
}
