"use server";

import { createClient } from "@/lib/supabase/server";

/** Acesso à página de Automações: owner (singleton) OU assinante premium. */
export async function canAccessAutomations(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("is_owner, is_premium")
    .eq("id", user.id)
    .single();

  return tenant?.is_owner === true || tenant?.is_premium === true;
}

export async function requireAutomationsAccess(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("is_owner, is_premium")
    .eq("id", user.id)
    .single();

  if (tenant?.is_owner !== true && tenant?.is_premium !== true) {
    throw new Error("Forbidden: owner or premium only");
  }
  return user.id;
}
