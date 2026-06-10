"use client";

import { useEffect, useState } from "react";
import { THEMES, getTheme, applyTheme, type ThemeId } from "@/lib/theme";

/** Grid of theme cards — click applies the theme to the whole site instantly. */
export function ThemeSwitcher() {
  const [active, setActive] = useState<ThemeId>("synthwave");

  useEffect(() => {
    setActive(getTheme());
  }, []);

  function pick(id: ThemeId) {
    applyTheme(id);
    setActive(id);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {THEMES.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={`card-interactive card text-left p-4 relative ${isActive ? "ring-1 ring-(--accent)" : ""}`}
            style={isActive ? { borderColor: "var(--border-glow)", boxShadow: "0 0 22px -8px var(--accent-glow)" } : undefined}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                {t.swatch.map((c, i) => (
                  <span key={i} className="w-5 h-5 rounded-md" style={{ background: c, boxShadow: i > 0 ? `0 0 8px ${c}66` : undefined, border: "1px solid rgba(255,255,255,0.08)" }} />
                ))}
              </div>
              {isActive && (
                <span className="badge badge-active">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Ativo
                </span>
              )}
            </div>
            <h3 className="text-foreground font-semibold text-sm tracking-tight">{t.name}</h3>
            <p className="text-[11px] text-(--text-muted) mt-0.5">{t.description}</p>
          </button>
        );
      })}
    </div>
  );
}
