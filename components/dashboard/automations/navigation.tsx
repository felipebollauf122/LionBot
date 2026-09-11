"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { automationHref, automationSectionForPath, automationSections } from "@/lib/automations/navigation";

export function AutomationNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const active = automationSectionForPath(pathname);
  const view = active.id === "channel-monitors" ? null : params.get("view");
  return (
    <div className="automation-navigation border-b border-(--border-subtle) bg-(--bg-surface) px-4 py-4 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-3 flex items-center justify-between gap-4">
          <Link href={automationHref("/dashboard/automations", view)} className="text-base font-semibold text-foreground">Automações</Link>
          <span className="text-sm text-(--text-muted)">Telegram</span>
        </div>
        <nav aria-label="Telas de automação" className="hidden flex-wrap gap-1 md:flex">
          {automationSections.map((section) => (
            <Link key={section.id} href={automationHref(section.path, view)}
              aria-current={section.id === active.id ? "page" : undefined}
              className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${section.id === active.id ? "bg-white/[0.06] text-foreground" : "text-(--text-muted) hover:bg-(--bg-hover) hover:text-foreground"}`}>
              {section.label}
            </Link>
          ))}
        </nav>
        <div className="md:hidden">
          <label htmlFor="automation-screen" className="sr-only">Tela de automação</label>
          <select id="automation-screen" className="input w-full" value={active.path} onChange={(event) => router.push(automationHref(event.target.value, view))}>
            {automationSections.map((section) => <option key={section.id} value={section.path}>{section.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
