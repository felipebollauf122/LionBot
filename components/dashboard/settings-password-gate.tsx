"use client";

import { useEffect, useState } from "react";

// Senha simples pra proteger acesso visual às configurações do bot.
// Validada no client e persistida em sessionStorage — vale enquanto a aba
// estiver aberta. Não substitui auth: apenas adiciona uma camada extra
// pra evitar que alguém com seu dashboard aberto na tela mexa em tokens/
// gateway/Pixel sem você notar.
const PASSWORD = "HappyNation";
const STORAGE_KEY = "eaglebot:bot-settings-unlocked";

export function SettingsPasswordGate({
  enabled,
  children,
}: {
  enabled: boolean; // só é ativo pra owner
  children: React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(!enabled);
  const [mounted, setMounted] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!enabled) {
      setUnlocked(true);
      return;
    }
    if (sessionStorage.getItem(STORAGE_KEY) === "1") {
      setUnlocked(true);
    }
  }, [enabled]);

  // SSR/hidratação: enquanto não montou, renderiza nada se enabled
  // (evita flash de conteúdo protegido antes do gate aparecer)
  if (!mounted && enabled) {
    return null;
  }

  if (unlocked) return <>{children}</>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value === PASSWORD) {
      sessionStorage.setItem(STORAGE_KEY, "1");
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
      setValue("");
    }
  };

  return (
    <div className="p-8 max-w-md mx-auto">
      <div className="card p-6 border border-(--border-default)">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-(--accent)/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <div>
            <h2 className="text-foreground font-semibold text-sm">
              Área protegida
            </h2>
            <p className="text-(--text-muted) text-xs">
              Configurações do bot exigem senha extra
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="input-label">Senha</label>
            <input
              type="password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(false);
              }}
              autoFocus
              className="input"
              placeholder="••••••••"
            />
            {error && (
              <p className="text-red-400 text-xs mt-1.5">
                Senha incorreta.
              </p>
            )}
          </div>
          <button type="submit" className="btn-primary w-full">
            Desbloquear
          </button>
        </form>

        <p className="text-(--text-ghost) text-xs mt-4 leading-relaxed">
          A senha fica liberada nesta aba até você fechá-la. Em outras abas
          ou após fechar o navegador, será pedida de novo.
        </p>
      </div>
    </div>
  );
}
