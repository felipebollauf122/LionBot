"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";

export async function getBundles(botId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { data, error } = await supabase
    .from("product_bundles")
    .select("*, product_bundle_items(*, products(id, name, ghost_name, price, currency, is_active))")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch bundles: ${error.message}`);
  return data ?? [];
}

export async function createBundle(botId: string, name: string, description: string, messageText: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id, tenant_id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { data, error } = await supabase.from("product_bundles").insert({
    tenant_id: bot.tenant_id,
    bot_id: botId,
    name,
    description,
    message_text: messageText || "Escolha um produto para comprar:",
    is_active: true,
  }).select("id").single();

  if (error) throw new Error(`Failed to create bundle: ${error.message}`);
  return data;
}

export async function updateBundle(bundleId: string, data: { name?: string; description?: string; message_text?: string; is_active?: boolean; ghost_name?: string | null }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let query = supabase.from("product_bundles").update(data).eq("id", bundleId);
  if (!admin) query = query.eq("tenant_id", user.id);
  const { error } = await query;
  if (error) throw new Error(`Failed to update bundle: ${error.message}`);
  return { success: true };
}

export async function deleteBundle(bundleId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let query = supabase.from("product_bundles").delete().eq("id", bundleId);
  if (!admin) query = query.eq("tenant_id", user.id);
  const { error } = await query;
  if (error) throw new Error(`Failed to delete bundle: ${error.message}`);
  return { success: true };
}

export async function addProductToBundle(bundleId: string, productId: string, sortOrder: number = 0) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let bundleQuery = supabase.from("product_bundles").select("id").eq("id", bundleId);
  if (!admin) bundleQuery = bundleQuery.eq("tenant_id", user.id);
  const { data: bundle } = await bundleQuery.single();
  if (!bundle) throw new Error("Bundle not found");

  const { error } = await supabase.from("product_bundle_items").insert({
    bundle_id: bundleId,
    product_id: productId,
    sort_order: sortOrder,
  });

  if (error) throw new Error(`Failed to add product to bundle: ${error.message}`);
  return { success: true };
}

export async function removeProductFromBundle(itemId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: item } = await supabase
    .from("product_bundle_items")
    .select("id, product_bundles!inner(tenant_id)")
    .eq("id", itemId)
    .single();

  if (!item) throw new Error("Item not found");

  const { error } = await supabase.from("product_bundle_items").delete().eq("id", itemId);
  if (error) throw new Error(`Failed to remove product from bundle: ${error.message}`);
  return { success: true };
}
