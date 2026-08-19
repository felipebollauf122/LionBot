"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";

interface MediaItem {
  url: string;
  kind: "photo" | "video";
  caption?: string;
  mime_type?: string;
  file_name?: string;
}

export interface TemplateInput {
  id?: string;
  name: string;
  new_channel_title: string;
  new_channel_about: string;
  new_channel_photo_url?: string | null;
  welcome_text: string;
  media_items: MediaItem[];
}

async function tenantId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

export async function listChannelTemplates() {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_templates")
    .select("*")
    .eq("tenant_id", tid)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveChannelTemplate(input: TemplateInput): Promise<{ id: string }> {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();

  const payload = {
    tenant_id: tid,
    name: input.name || "Template sem nome",
    new_channel_title: input.new_channel_title,
    new_channel_about: input.new_channel_about ?? "",
    new_channel_photo_url: input.new_channel_photo_url ?? null,
    welcome_text: input.welcome_text ?? "",
    media_items: input.media_items ?? [],
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await supabase
      .from("channel_templates")
      .update(payload)
      .eq("id", input.id)
      .eq("tenant_id", tid);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/automations/channel-monitors");
    return { id: input.id };
  }
  const { data, error } = await supabase
    .from("channel_templates")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations/channel-monitors");
  return { id: data.id };
}

export async function deleteChannelTemplate(id: string): Promise<void> {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("channel_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tid);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations/channel-monitors");
}

export async function listChannelMonitors() {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_monitors")
    .select(`
      *,
      account:mtproto_accounts(id, phone_number, display_name, status),
      template:channel_templates(id, name, new_channel_title)
    `)
    .eq("tenant_id", tid)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listMonitorableDialogs(accountId: string) {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  // Só canais (kind in channel_owner | channel_subscriber). Channel_owner
  // primeiro (mais relevante pra monitorar).
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("tenant_id", tid)
    .single();
  if (!account) return [];
  const { data } = await supabase
    .from("mtproto_dialogs")
    .select("id, peer_id, peer_access_hash, title, username, kind")
    .eq("account_id", accountId)
    .in("kind", ["channel_owner", "channel_subscriber"])
    .order("kind", { ascending: true })
    .order("title", { ascending: true })
    .limit(500);
  return data ?? [];
}

export async function addChannelMonitor(input: {
  accountId: string;
  templateId: string;
  peerChannelId: string;
  peerAccessHash: string | null;
  channelTitle: string | null;
  channelUsername: string | null;
}): Promise<void> {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  const { error } = await supabase.from("channel_monitors").insert({
    tenant_id: tid,
    account_id: input.accountId,
    template_id: input.templateId,
    peer_channel_id: input.peerChannelId,
    peer_access_hash: input.peerAccessHash,
    channel_title: input.channelTitle,
    channel_username: input.channelUsername,
    status: "active",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations/channel-monitors");
}

export async function pauseChannelMonitor(id: string, paused: boolean): Promise<void> {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  await supabase
    .from("channel_monitors")
    .update({ status: paused ? "paused" : "active" })
    .eq("id", id)
    .eq("tenant_id", tid);
  revalidatePath("/dashboard/automations/channel-monitors");
}

export async function deleteChannelMonitor(id: string): Promise<void> {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const supabase = await createClient();
  await supabase.from("channel_monitors").delete().eq("id", id).eq("tenant_id", tid);
  revalidatePath("/dashboard/automations/channel-monitors");
}

/**
 * Faz upload de uma mídia pro Supabase Storage bucket
 * 'channel-template-media' (privado). Retorna a URL signed
 * de longa duração (1 ano).
 *
 * O caller (componente client) já recebe o buffer via FormData;
 * essa action faz o upload server-side com service role.
 */
export async function uploadTemplateMedia(formData: FormData): Promise<{ url: string; kind: "photo" | "video"; mime_type: string; file_name: string }> {
  await requireAutomationsAccess();
  const tid = await tenantId();
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("file ausente");

  const buf = Buffer.from(await file.arrayBuffer());
  const supabase = await createClient();
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${tid}/${ts}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("channel-template-media")
    .upload(path, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

  const { data: signed, error: signErr } = await supabase.storage
    .from("channel-template-media")
    .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 ano
  if (signErr || !signed) throw new Error(`Signed URL falhou: ${signErr?.message ?? "?"}`);

  const kind: "photo" | "video" = (file.type || "").startsWith("video/") ? "video" : "photo";
  return {
    url: signed.signedUrl,
    kind,
    mime_type: file.type || "application/octet-stream",
    file_name: safeName,
  };
}
