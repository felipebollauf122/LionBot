"use client";

import { useEffect } from "react";
import { applyTheme, saveCustomColors, type ThemeId, type CustomColors } from "@/lib/theme";

/**
 * Sincroniza o tema do BANCO (fonte de verdade) ao entrar na área logada.
 * Conserta o caso do Brave que apaga o localStorage: o boot script (layout)
 * usa localStorage só pra evitar flash; aqui re-aplicamos o tema salvo na conta
 * e re-populamos o localStorage. Roda 1x no mount.
 */
export function ThemeSync({ theme, customTheme }: { theme: string | null; customTheme: CustomColors | null }) {
  useEffect(() => {
    if (!theme) return; // usuário nunca escolheu → mantém o padrão
    if (theme === "custom" && customTheme) {
      saveCustomColors(customTheme); // grava no localStorage + aplica as cores
    }
    applyTheme(theme as ThemeId); // aplica o data-theme e persiste no localStorage
  }, [theme, customTheme]);
  return null;
}
