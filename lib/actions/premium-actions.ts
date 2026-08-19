"use server";

import { createClient } from "@/lib/supabase/server";

export async function isPremium(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("is_premium")
    .eq("id", user.id)
    .single();

  return tenant?.is_premium === true;
}

export async function requirePremium(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("is_premium")
    .eq("id", user.id)
    .single();

  if (tenant?.is_premium !== true) throw new Error("Forbidden: premium only");
  return user.id;
}
