import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { resolveViewScope, getViewableUsers } from "@/lib/actions/admin-actions";
import { automationHref, type AutomationSearchParams } from "./navigation";

export async function getAutomationPageContext(searchParams: Promise<AutomationSearchParams>) {
  if (!(await canAccessAutomations())) notFound();
  const params = await searchParams;
  const requested = typeof params.view === "string" ? params.view : undefined;
  const scope = await resolveViewScope(requested);
  if (!scope.tenantId && scope.mode !== "all") notFound();
  const view = scope.mode === "user" ? scope.tenantId! : scope.mode;
  const [supabase, users] = await Promise.all([
    createClient(),
    scope.isAdmin ? getViewableUsers() : Promise.resolve([]),
  ]);
  return {
    supabase, scope, users, view,
    canCreate: scope.mode !== "all",
    actingTenantId: scope.tenantId ?? undefined,
    href: (path: string) => automationHref(path, view),
  };
}
