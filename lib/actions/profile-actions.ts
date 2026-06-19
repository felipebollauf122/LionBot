"use server";

import { createClient } from "@/lib/supabase/server";
import type { CustomColors } from "@/lib/theme";

export interface ProfileData {
  name: string;
  theme: string | null;
  customTheme: CustomColors | null;
}

/** Lê o perfil do usuário logado (nome + tema persistidos em tenants). */
export async function getProfile(): Promise<ProfileData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("tenants")
    .select("name,theme,custom_theme")
    .eq("id", user.id)
    .single();
  return {
    name: (data?.name as string) ?? "",
    theme: (data?.theme as string) ?? null,
    customTheme: (data?.custom_theme as CustomColors) ?? null,
  };
}

/** Atualiza o nome de exibição do usuário (tenants.name). */
export async function updateProfileName(name: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Não autenticado" };
  const clean = name.trim().slice(0, 60);
  const { error } = await supabase.from("tenants").update({ name: clean }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Persiste o tema escolhido (preset id ou "custom" + paleta). RLS por auth.uid(). */
export async function updateProfileTheme(
  theme: string,
  customTheme?: CustomColors | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Não autenticado" };
  const patch: { theme: string; custom_theme?: CustomColors | null } = { theme };
  if (theme === "custom") patch.custom_theme = customTheme ?? null;
  const { error } = await supabase.from("tenants").update(patch).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
