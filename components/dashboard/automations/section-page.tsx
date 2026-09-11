import Link from "next/link";
import type { ReactNode } from "react";
import { AdminViewSwitcher } from "@/components/dashboard/admin-view-switcher";
import type { getAutomationPageContext } from "@/lib/automations/page-context";

export function AutomationSectionPage({ title, description, context, action, children }: {
  title: string;
  description: string;
  context: Awaited<ReturnType<typeof getAutomationPageContext>>;
  action?: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-8 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-(--text-secondary)">{description}</p>
          </div>
          {action && context.canCreate && <Link href={context.href(action.href)} className="btn-primary shrink-0">{action.label}</Link>}
        </div>
        {context.scope.isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <AdminViewSwitcher users={context.users} currentView={context.view} />
            {!context.canCreate && <p className="text-sm text-(--text-secondary)">Para criar, selecione Minha ou um usuário.</p>}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}
