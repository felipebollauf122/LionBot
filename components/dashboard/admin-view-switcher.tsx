"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import type { ViewableUser } from "@/lib/actions/admin-actions";

/**
 * Seletor de visão de ADMIN (só renderiza pra admin). Alterna a dashboard/análises
 * entre "Minha" (só o admin), "Todos" (global) e um usuário específico da lista.
 * Estado via URL (?view=mine|all|<tenantId>) — a page server lê e filtra.
 */
export function AdminViewSwitcher({ users, currentView }: { users: ViewableUser[]; currentView: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function setView(view: string) {
    const next = new URLSearchParams(params.toString());
    if (view === "all") next.delete("view");
    else next.set("view", view);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  const selectedUser = users.find((u) => u.id === currentView);
  const isUser = !!selectedUser;
  const isMine = currentView === "mine";
  const isAll = !isUser && !isMine;

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/[0.02] border border-(--border-subtle)">
      <button onClick={() => setView("mine")} className={`toggle-btn ${isMine ? "on" : "off"}`}>
        Minha
      </button>
      <button onClick={() => setView("all")} className={`toggle-btn ${isAll ? "on" : "off"}`}>
        Todos
      </button>

      {/* Dropdown de usuário */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`toggle-btn ${isUser ? "on" : "off"} flex items-center gap-1.5 max-w-[180px]`}
        >
          <span className="truncate">{isUser ? selectedUser!.name : "Usuário"}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-64 max-h-80 overflow-y-auto z-50 rounded-xl border border-(--border-default) bg-[#0b0b12] shadow-2xl p-1 animate-in">
            {users.length === 0 ? (
              <p className="text-xs text-(--text-muted) px-3 py-2">Nenhum usuário</p>
            ) : (
              users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setView(u.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors hover:bg-white/5 ${u.id === currentView ? "bg-(--accent)/10" : ""}`}
                >
                  <div className="text-sm text-foreground truncate">{u.name}</div>
                  <div className="text-[11px] text-(--text-muted) truncate font-mono">{u.email}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
