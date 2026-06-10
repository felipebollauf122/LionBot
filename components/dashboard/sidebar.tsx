"use client";

import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LionMark } from "@/components/brand/lion-mark";

interface SidebarProps {
  isAdmin?: boolean;
  isOwner?: boolean;
}

export function Sidebar({ isAdmin, isOwner }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const isBotsActive = pathname === "/dashboard" || (pathname.startsWith("/dashboard/bots") && !pathname.startsWith("/dashboard/admin"));
  const isAutomationsActive = pathname.startsWith("/dashboard/automations");
  const isAdminActive = pathname.startsWith("/dashboard/admin");

  return (
    <aside className="w-[270px] min-h-screen flex flex-col relative" style={{ background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)" }}>
      {/* Subtle right border with glow */}
      <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-(--border-default) to-transparent" />

      {/* Ambient glow */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-(--accent)/[0.03] to-transparent pointer-events-none" />

      {/* Logo */}
      <div className="h-[72px] px-6 flex items-center relative">
        <div className="flex items-center gap-2.5">
          <LionMark size={34} />
          <span className="text-base font-bold tracking-tight text-foreground page-title">
            Lion<span className="gradient-text">Bot</span>
          </span>
        </div>
        {/* Bottom separator with glow */}
        <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--border-default) to-transparent" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 pt-6 pb-4">
        <p className="text-(--text-ghost) text-[10px] font-bold uppercase tracking-[0.14em] px-3 mb-3">
          Menu
        </p>
        <a
          href="/dashboard"
          className={`nav-item ${isBotsActive ? "active" : ""}`}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isBotsActive ? "bg-(--accent)/15" : "bg-white/4"}`} style={isBotsActive ? { boxShadow: "0 0 12px -4px rgba(255,43,214,0.3)" } : {}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          Meus Bots
        </a>
        {isOwner && (
          <a
            href="/dashboard/automations"
            className={`nav-item ${isAutomationsActive ? "active" : ""}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isAutomationsActive ? "bg-(--accent)/15" : "bg-white/4"}`} style={isAutomationsActive ? { boxShadow: "0 0 12px -4px rgba(255,43,214,0.3)" } : {}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            Automações
          </a>
        )}
        {isAdmin && (
          <>
            <div className="my-4 mx-2 h-px bg-linear-to-r from-transparent via-(--border-default) to-transparent" />
            <p className="text-(--text-ghost) text-[10px] font-bold uppercase tracking-[0.14em] px-3 mb-3">
              Administracao
            </p>
            <a
              href="/dashboard/admin/users"
              className={`nav-item ${isAdminActive ? "active" : ""}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isAdminActive ? "bg-(--accent)/15" : "bg-white/4"}`} style={isAdminActive ? { boxShadow: "0 0 12px -4px rgba(255,43,214,0.3)" } : {}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              Admin
            </a>
          </>
        )}
      </nav>

      {/* Logout */}
      <div className="p-3 relative">
        <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--border-default) to-transparent" />
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 mt-1 rounded-xl text-[13px] text-(--text-muted) hover:text-(--red) hover:bg-(--red-muted) transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-white/3 flex items-center justify-center group-hover:bg-(--red)/10 transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </div>
          Sair
        </button>
      </div>
    </aside>
  );
}
