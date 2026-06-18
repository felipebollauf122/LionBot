"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { LionMark } from "@/components/brand/lion-mark";

interface DashboardShellProps {
  isAdmin?: boolean;
  isOwner?: boolean;
  children: ReactNode;
}

/**
 * Client shell that owns the mobile-drawer state for the dashboard sidebar.
 * The layout (server component) can't hold useState, so it delegates here.
 * Desktop (md+): sidebar is static in-flow. Mobile: sidebar is an off-canvas
 * drawer toggled by the hamburger top bar.
 */
export function DashboardShell({ isAdmin, isOwner, children }: DashboardShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Mobile top bar with hamburger (hidden on desktop) */}
      <header className="md:hidden sticky top-0 z-30 h-14 pt-safe box-content flex items-center gap-3 px-4 glass">
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-(--text-secondary) hover:text-foreground hover:bg-white/5 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <LionMark size={26} />
          <span className="text-base font-bold tracking-tight text-foreground page-title">
            Lion<span className="gradient-text">Bot</span>
          </span>
        </div>
      </header>

      {/* Backdrop (mobile only, when drawer open) */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden animate-in"
          aria-hidden
        />
      )}

      <Sidebar isAdmin={isAdmin} isOwner={isOwner} open={open} onClose={() => setOpen(false)} />

      <main className="flex-1 min-w-0 relative z-10">{children}</main>
    </div>
  );
}
