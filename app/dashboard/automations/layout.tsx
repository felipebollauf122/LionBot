import { Suspense } from "react";
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { AutomationNavigation } from "@/components/dashboard/automations/navigation";
import "./workspace.css";

export default async function AutomationsLayout({ children }: { children: React.ReactNode }) {
  if (!(await canAccessAutomations())) notFound();
  return (
    <div className="automation-workspace min-w-0">
      <Suspense fallback={<div className="h-28 border-b border-(--border-default)" />}>
        <AutomationNavigation />
      </Suspense>
      {children}
    </div>
  );
}
