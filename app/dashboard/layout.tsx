import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { GalaxyBackground } from "@/components/landing/hero3d/galaxy-background";
import { ThemeSync } from "@/components/dashboard/theme-sync";
import type { CustomColors } from "@/lib/theme";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("role, is_owner, is_premium, theme, custom_theme")
    .eq("id", user.id)
    .single();

  return (
    <div className="relative">
      {/* Sincroniza o tema salvo na conta (fonte de verdade — sobrevive ao Brave
          limpar o localStorage). */}
      <ThemeSync
        theme={(tenant?.theme as string) ?? null}
        customTheme={(tenant?.custom_theme as CustomColors) ?? null}
      />
      {/* Faixa preta mínima cobrindo a safe-area do topo (notch/Dynamic Island)
          — nada vaza atrás do relógio ao rolar. Vale em toda a área logada. */}
      <div className="safe-top-bar" aria-hidden />
      {/* Fundo de galáxia SUTIL — bem ao fundo (z-0, atrás de tudo), só estrelas
          + um toque de roxo/névoa, sem parallax pra ficar quieto na dashboard. */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <GalaxyBackground className="absolute inset-0 h-full w-full" nebula={0.35} stars={0.7} parallax={false} />
      </div>
      <DashboardShell isAdmin={tenant?.role === "admin"} isOwner={tenant?.is_owner === true} isPremium={tenant?.is_premium === true}>
        {children}
      </DashboardShell>
    </div>
  );
}
