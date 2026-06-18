"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BotSidebar, botNavItems } from "@/components/dashboard/bot-sidebar";

interface BotShellProps {
  botId: string;
  botUsername: string;
  avatarUrl?: string | null;
  basePath?: string;
  children: ReactNode;
}

// 4 primary tabs for the mobile bottom bar; the rest live behind "Mais".
const PRIMARY = ["flows", "products", "leads", "transactions"];

/**
 * Console shell for a bot. Desktop: the BotRail (64px, hover-expand) sits
 * statically at the left. Mobile: a bottom-tab-bar of primary destinations +
 * "Mais" that opens the full rail as an off-canvas drawer.
 */
export function BotShell({ botId, botUsername, avatarUrl, basePath, children }: BotShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const base = basePath ?? `/dashboard/bots/${botId}`;
  const primaryItems = PRIMARY.map((seg) => botNavItems.find((i) => i.segment === seg)!).filter(Boolean);

  // The flow editor is a full-screen canvas — it must escape the console shell
  // (no rail, no bottom-tabs) so it gets the entire viewport.
  const isFullscreen = pathname.includes("/editor");
  if (isFullscreen) {
    return <div className="min-h-screen bg-(--bg-root)">{children}</div>;
  }

  return (
    <div className="flex min-h-screen bg-(--bg-root)">
      {/* Desktop rail (static) / mobile drawer */}
      <BotSidebar botId={botId} botUsername={botUsername} avatarUrl={avatarUrl} basePath={basePath} open={open} onClose={() => setOpen(false)} />

      {/* Mobile drawer backdrop */}
      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-in" aria-hidden />
      )}

      <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>

      {/* Mobile bottom-tab-bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 glass border-t border-(--border-subtle) flex items-stretch h-16 px-1">
        {primaryItems.map((item) => {
          const href = `${base}/${item.segment}`;
          const active = pathname.startsWith(href);
          return (
            <a key={item.segment} href={href} className="flex-1 flex flex-col items-center justify-center gap-1 relative">
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full" style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} />}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? item.color : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              <span className="text-[9px]" style={{ color: active ? item.color : "var(--text-ghost)" }}>{item.label}</span>
            </a>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-1 text-(--text-muted)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
          <span className="text-[9px] text-(--text-ghost)">Mais</span>
        </button>
      </nav>
    </div>
  );
}
