import { getBotsFleet } from "@/lib/actions/analytics-actions";
import { resolveViewScope, getViewableUsers } from "@/lib/actions/admin-actions";
import { BotsFleet } from "@/components/dashboard/bots-fleet";

export const dynamic = "force-dynamic";

type SP = { [key: string]: string | string[] | undefined };

export default async function BotsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const requestedView = typeof sp.view === "string" ? sp.view : undefined;
  // Visão de admin (Minha/Todos/Por usuário) — restringe a frota a um usuário.
  const scope = await resolveViewScope(requestedView);

  const [bots, viewUsers] = await Promise.all([
    getBotsFleet(scope.tenantId),
    scope.isAdmin ? getViewableUsers() : Promise.resolve([]),
  ]);

  return (
    <BotsFleet
      bots={bots}
      isAdmin={scope.isAdmin}
      viewUsers={viewUsers}
      currentView={requestedView ?? "all"}
    />
  );
}
