"use client";

import { useState } from "react";
import { CommandBar } from "@/components/dashboard/console/command-bar";
import { ThemeSwitcher } from "@/components/dashboard/theme-switcher";
import { PushToggle } from "@/components/dashboard/push-toggle";

interface ProfileViewProps {
  name: string;
  email: string;
}

type Section = "account" | "appearance" | "notifications";

const SECTIONS: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: "account", label: "Conta", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
  { key: "appearance", label: "Aparência", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></svg> },
  { key: "notifications", label: "Notificações", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg> },
];

export function ProfileView({ name, email }: ProfileViewProps) {
  const [section, setSection] = useState<Section>("appearance");

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar title="Meu Perfil" subtitle="conta · aparência · notificações" />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6 max-w-5xl mx-auto w-full">
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Section rail */}
          <nav className="w-full lg:w-56 shrink-0 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`nav-item shrink-0 ${section === s.key ? "active" : ""}`}
              >
                <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/4">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>

          {/* Section content */}
          <div className="flex-1 min-w-0">
            {section === "account" && (
              <div className="card p-5 sm:p-6 animate-in space-y-4">
                <h2 className="text-foreground font-semibold tracking-tight page-title">Conta</h2>
                <div className="flex items-center gap-4 py-2">
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold stat-value shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}>
                    {(name || email || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-foreground font-semibold truncate">{name || "—"}</p>
                    <p className="text-(--text-muted) text-sm truncate">{email}</p>
                  </div>
                </div>
                <p className="text-[11px] text-(--text-ghost)">A edição de dados da conta estará disponível em breve.</p>
              </div>
            )}

            {section === "appearance" && (
              <div className="card p-5 sm:p-6 animate-in space-y-4">
                <div>
                  <h2 className="text-foreground font-semibold tracking-tight page-title">Tema</h2>
                  <p className="text-[12px] text-(--text-muted) mt-1">Muda toda a paleta do site. A escolha fica salva neste navegador.</p>
                </div>
                <ThemeSwitcher />
              </div>
            )}

            {section === "notifications" && (
              <div className="card p-5 sm:p-6 animate-in space-y-4">
                <div>
                  <h2 className="text-foreground font-semibold tracking-tight page-title">Notificações push</h2>
                  <p className="text-[12px] text-(--text-muted) mt-1">Receba alertas de venda direto no seu dispositivo.</p>
                </div>
                <PushToggle />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
