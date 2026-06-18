"use client";

import { useEffect, type ReactNode } from "react";

interface ContextDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: string;
  /** primary actions shown in the drawer header (right side) */
  actions?: ReactNode;
  children: ReactNode;
  /** drawer width on desktop (default 'md' = 28rem) */
  size?: "sm" | "md" | "lg";
}

const WIDTH = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" };

/**
 * Sliding panel from the right — the home for all detail/edit that used to be
 * inline forms. Overlay with glass + backdrop blur; ESC + backdrop close it.
 * Never pushes the page; the list stays put behind it.
 */
export function ContextDrawer({ open, onClose, title, subtitle, actions, children, size = "md" }: ContextDrawerProps) {
  // close on ESC + lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        className={`fixed inset-y-0 right-0 z-50 w-full ${WIDTH[size]} glass flex flex-col
          transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ boxShadow: "var(--shadow-xl)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-(--border-subtle) shrink-0">
          <div className="min-w-0">
            {typeof title === "string" ? (
              <h2 className="text-foreground font-semibold tracking-tight truncate page-title">{title}</h2>
            ) : (
              title
            )}
            {subtitle && <p className="text-[11px] uppercase tracking-[0.12em] text-(--text-ghost) mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{open && children}</div>
      </aside>
    </>
  );
}
