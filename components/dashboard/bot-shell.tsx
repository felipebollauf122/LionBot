"use client";

import { useState, type ReactNode } from "react";
import { BotSidebar } from "@/components/dashboard/bot-sidebar";

interface BotShellProps {
  botId: string;
  botUsername: string;
  avatarUrl?: string | null;
  basePath?: string;
  children: ReactNode;
}

/** Mobile-drawer shell for the per-bot sidebar (second-level nav). */
export function BotShell({ botId, botUsername, avatarUrl, basePath, children }: BotShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#0a0a0f]">
      {/* Mobile bot-nav bar */}
      <header className="md:hidden sticky top-0 z-30 h-12 flex items-center gap-3 px-4 glass">
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu do bot"
          className="w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-(--text-secondary) hover:text-foreground hover:bg-white/5 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-foreground truncate">@{botUsername}</span>
      </header>

      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-in" aria-hidden />
      )}

      <BotSidebar botId={botId} botUsername={botUsername} avatarUrl={avatarUrl} basePath={basePath} open={open} onClose={() => setOpen(false)} />

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
