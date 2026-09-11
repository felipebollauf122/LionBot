import Link from "next/link";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { automationSections, type AutomationSearchParams } from "@/lib/automations/navigation";
import { getAutomationPageContext } from "@/lib/automations/page-context";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<AutomationSearchParams> }) {
  const context = await getAutomationPageContext(searchParams);
  return (
    <AutomationSectionPage title="O que vamos automatizar?" description="Cada tarefa tem seu próprio espaço. Escolha uma área para começar ou continuar seu trabalho." context={context}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">Conteúdo e campanhas</h2>
          <div className="divide-y divide-(--border-default)">
            {automationSections.slice(1, 6).map((section) => (
              <Link key={section.id} href={context.href(section.path)} className="group flex items-center justify-between gap-5 rounded-lg px-3 py-5 transition-colors hover:bg-(--bg-hover)">
                <div className="min-w-0">
                  <h3 className="font-medium text-foreground group-hover:text-(--accent)">{section.label}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-(--text-secondary)">{section.description}</p>
                </div>
                <span className="shrink-0 text-sm text-(--text-secondary) group-hover:text-(--accent)">Abrir</span>
              </Link>
            ))}
          </div>
        </div>
        <aside className="space-y-6 border-t border-(--border-default) pt-6 lg:border-t-0 lg:pt-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Conexões</h2>
            <p className="mt-2 text-sm leading-relaxed text-(--text-secondary)">Primeira vez por aqui? Conecte uma conta do Telegram e configure seu bot de publicação.</p>
          </div>
          {automationSections.slice(6).map((section) => (
            <Link key={section.id} href={context.href(section.path)} className="block rounded-lg border border-(--border-default) bg-(--bg-surface) p-4 transition-colors hover:border-(--accent)">
              <h3 className="text-sm font-semibold text-foreground">{section.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--text-secondary)">{section.description}</p>
            </Link>
          ))}
        </aside>
      </div>
    </AutomationSectionPage>
  );
}
