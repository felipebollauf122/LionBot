"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, getTheme, applyTheme, getCustomColors, saveCustomColors, type ThemeId, type CustomColors } from "@/lib/theme";
import { updateProfileTheme } from "@/lib/actions/profile-actions";

/** Grid of theme cards + a custom palette builder — applies instantly. */
export function ThemeSwitcher() {
  const [active, setActive] = useState<ThemeId>("synthwave");
  const [custom, setCustom] = useState<CustomColors>({ bg: "#0a0612", accent: "#ff2bd6", cyan: "#00e5ff", purple: "#b14bff" });
  // debounce do save do tema personalizado: arrastar o color picker dispara
  // onChange dezenas de vezes/seg. Salvar a cada uma = enxurrada de requisições
  // + race (uma intermediária chega depois e sobrescreve a cor final). Salvamos
  // só ~600ms depois da ÚLTIMA mudança → 1 request, sempre com a cor final.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setActive(getTheme());
      setCustom(getCustomColors());
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // limpa o timer pendente ao desmontar (evita salvar depois de sair da tela).
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function pick(id: ThemeId) {
    applyTheme(id);
    setActive(id);
    // troca de preset salva NA HORA (cancela qualquer save de cor pendente).
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    void updateProfileTheme(id, id === "custom" ? getCustomColors() : null);
  }

  function updateCustom(key: keyof CustomColors, value: string) {
    const next = { ...custom, [key]: value };
    setCustom(next);
    saveCustomColors(next);     // localStorage na hora (preview instantâneo)
    if (active !== "custom") {
      applyTheme("custom");
      setActive("custom");
    } else {
      applyTheme("custom");     // re-aplica as cores novas sem trocar de tema
    }
    // banco: debounced — só salva quando o usuário PARA de mexer na cor.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateProfileTheme("custom", next);
      saveTimer.current = null;
    }, 600);
  }

  return (
    <div className="space-y-4">
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

      {/* Custom palette builder */}
      <div className={`card p-4 ${active === "custom" ? "ring-1 ring-(--accent)" : ""}`} style={active === "custom" ? { borderColor: "var(--border-glow)", boxShadow: "0 0 22px -8px var(--accent-glow)" } : undefined}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-foreground font-semibold text-sm tracking-tight">Personalizado</h3>
            <p className="text-[11px] text-(--text-muted) mt-0.5">Escolha suas próprias cores</p>
          </div>
          {active === "custom" && (
            <span className="badge badge-active">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
              Ativo
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ColorField label="Fundo" value={custom.bg} onChange={(v) => updateCustom("bg", v)} />
          <ColorField label="Primária" value={custom.accent} onChange={(v) => updateCustom("accent", v)} />
          <ColorField label="Ciano" value={custom.cyan} onChange={(v) => updateCustom("cyan", v)} />
          <ColorField label="Roxo" value={custom.purple} onChange={(v) => updateCustom("purple", v)} />
        </div>
        {active !== "custom" && (
          <button onClick={() => pick("custom")} className="btn-ghost mt-4 text-xs! py-2!">
            Usar tema personalizado
          </button>
        )}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-(--text-muted)">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-(--border-subtle) bg-white/[0.02] px-2 py-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
          style={{ appearance: "none" }}
        />
        <span className="text-[11px] font-mono stat-value text-(--text-secondary) truncate uppercase">{value}</span>
      </div>
    </label>
  );
}
