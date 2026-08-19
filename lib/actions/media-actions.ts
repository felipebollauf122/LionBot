"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type { MediaAsset } from "@/lib/types/database";

export async function listMediaAssets(botId: string): Promise<MediaAsset[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("media_assets")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false });

  return (data ?? []) as MediaAsset[];
}

export async function createMediaAsset(botId: string, url: string, kind: "image" | "video", label?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Admin creating media for another user's bot — use bot's tenant_id
  const admin = await isAdmin();
  let tenantId = user.id;
  if (admin) {
    const { data: bot } = await supabase.from("bots").select("tenant_id").eq("id", botId).single();
    if (bot) tenantId = bot.tenant_id;
  }

  const { error } = await supabase.from("media_assets").insert({
    tenant_id: tenantId,
    bot_id: botId,
    url,
    kind,
    label: label ?? null,
    is_active: true,
  });

  if (error) throw new Error(`Failed to create media asset: ${error.message}`);
  return { success: true };
}

export async function updateMediaAsset(assetId: string, data: { label?: string | null; is_active?: boolean }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let query = supabase.from("media_assets").update(data).eq("id", assetId);
  if (!admin) query = query.eq("tenant_id", user.id);
  const { error } = await query;
  if (error) throw new Error(`Failed to update media asset: ${error.message}`);
  return { success: true };
}

export async function deleteMediaAsset(assetId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let query = supabase.from("media_assets").delete().eq("id", assetId);
  if (!admin) query = query.eq("tenant_id", user.id);
  const { error } = await query;
  if (error) throw new Error(`Failed to delete media asset: ${error.message}`);
  return { success: true };
}
