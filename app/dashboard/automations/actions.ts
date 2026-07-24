"use server";

import { createClient } from "@/lib/supabase/server";
import { parseTargets } from "@/lib/mtproto/target-parser";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/actions/owner-actions";

// Kinds elegíveis em campanha global — owner pediu alcance máximo, então
// inclui grupos/canais onde só participa (risco de ban por spam aceito).
// Exclui bot (desperdício) e self (Saved Messages).
// Espelha GLOBAL_DIALOG_KINDS em server/src/workers/mtproto-worker.ts.
const GLOBAL_DIALOG_KINDS = [
  "contact",
  "dm",
  "group_admin",
  "group_member",
  "channel_owner",
  "channel_subscriber",
];

type MtprotoJob =
  | { kind: "auth.request-code"; accountId: string; phoneNumber: string }
  | { kind: "auth.sign-in"; accountId: string; phoneNumber: string; code: string }
  | { kind: "auth.submit-password"; accountId: string; password: string }
  | { kind: "campaign.run"; campaignId: string }
  | { kind: "account.sync-dialogs"; accountId: string }
  | { kind: "clone.run"; cloneJobId: string };

async function enqueueJob(job: MtprotoJob): Promise<void> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const res = await fetch(`${serverUrl}/api/mtproto/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (!res.ok) {
    throw new Error(`Falha ao enfileirar job (${res.status})`);
  }
}

async function currentTenantId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

export async function startAddAccount(
  phoneNumber: string,
  displayName: string,
): Promise<{ accountId: string }> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mtproto_accounts")
    .insert({
      tenant_id: tenantId,
      phone_number: phoneNumber,
      display_name: displayName || null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await enqueueJob({ kind: "auth.request-code", accountId: data.id, phoneNumber });
  revalidatePath("/dashboard/automations");
  return { accountId: data.id };
}

export async function submitAuthCode(accountId: string, code: string): Promise<void> {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("phone_number")
    .eq("id", accountId)
    .single();
  if (!data) throw new Error("account not found");
  await enqueueJob({
    kind: "auth.sign-in",
    accountId,
    phoneNumber: data.phone_number,
    code,
  });
  revalidatePath("/dashboard/automations");
}

export async function submitAuthPassword(
  accountId: string,
  password: string,
): Promise<void> {
  await requireOwner();
  await enqueueJob({ kind: "auth.submit-password", accountId, password });
  revalidatePath("/dashboard/automations");
}

export async function removeAccount(accountId: string): Promise<void> {
  await requireOwner();
  const supabase = await createClient();
  await supabase.from("mtproto_accounts").delete().eq("id", accountId);
  revalidatePath("/dashboard/automations");
}

export type CreateCampaignResult =
  | { ok: true; campaignId: string }
  | { ok: false; error: string };

export async function createCampaign(input: {
  name: string;
  message: string;
  targetsRaw: string;
  delayMin: number;
  delayMax: number;
  dialogIds?: string[];
  recurrenceHours?: number | null;
  global?: boolean;
}): Promise<CreateCampaignResult> {
  try {
    await requireOwner();
    const tenantId = await currentTenantId();
    const supabase = await createClient();

    let recurrenceHours: number | null = null;
    if (input.recurrenceHours != null && input.recurrenceHours > 0) {
      if (input.recurrenceHours < 6) {
        return { ok: false, error: "Mínimo 6 horas entre execuções (anti-ban)." };
      }
      recurrenceHours = Math.floor(input.recurrenceHours);
    }

    const isGlobal = Boolean(input.global);

    if (isGlobal) {
      const { data: accounts } = await supabase
        .from("mtproto_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "active");
      if (!accounts || accounts.length === 0) {
        return { ok: false, error: "Nenhuma conta ativa. Conecte pelo menos uma conta antes." };
      }
      const accountIds = accounts.map((a) => a.id);

      const { data: dialogs, error: dErr } = await supabase
        .from("mtproto_dialogs")
        .select("id, account_id, title, username, kind")
        .in("account_id", accountIds)
        .in("kind", GLOBAL_DIALOG_KINDS);
      if (dErr) return { ok: false, error: `Failed to load global dialogs: ${dErr.message}` };
      const dialogList = dialogs ?? [];

      // Mesmo com dialogList vazio, segue criando a campanha — o worker faz
      // sync inline antes do run global (refreshGlobalCampaignTargets) e
      // popula os targets na hora. Garante UX "salvar e disparar" funciona
      // mesmo se o user nunca sincronizou manualmente.

      const { data: campaign, error: cErr } = await supabase
        .from("mtproto_campaigns")
        .insert({
          tenant_id: tenantId,
          name: input.name,
          message_text: input.message,
          delay_min_seconds: input.delayMin,
          delay_max_seconds: input.delayMax,
          total_targets: dialogList.length,
          status: "draft",
          failed_count: 0,
          recurrence_hours: recurrenceHours,
          is_global: true,
        })
        .select("id")
        .single();
      if (cErr) return { ok: false, error: cErr.message };

      if (dialogList.length > 0) {
        const rows = dialogList.map((d) => ({
          campaign_id: campaign.id,
          target_identifier: d.username ?? d.title ?? d.id,
          target_type: "username" as const,
          status: "pending" as const,
          dialog_id: d.id,
          account_id: d.account_id,
        }));
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          const { error } = await supabase.from("mtproto_targets").insert(batch);
          if (error) return { ok: false, error: `Insert targets failed: ${error.message}` };
        }
      }

      revalidatePath("/dashboard/automations");
      return { ok: true, campaignId: campaign.id };
    }

    const parsed = parseTargets(input.targetsRaw || "");
    const valid = parsed.filter((t) => t.valid);
    const invalid = parsed.filter((t) => !t.valid);

    let dialogRows: Array<{ id: string; account_id: string; title: string | null; username: string | null }> = [];
    if (input.dialogIds && input.dialogIds.length > 0) {
      const { data, error } = await supabase
        .from("mtproto_dialogs")
        .select("id, account_id, title, username, mtproto_accounts!inner(tenant_id)")
        .in("id", input.dialogIds)
        .eq("mtproto_accounts.tenant_id", tenantId);
      if (error) return { ok: false, error: `Failed to load dialogs: ${error.message}` };
      dialogRows = (data ?? []) as typeof dialogRows;
    }

    const totalTargets = valid.length + invalid.length + dialogRows.length;
    if (totalTargets === 0) {
      return { ok: false, error: "Campanha sem alvos: cole uma lista ou selecione contatos/grupos." };
    }

    const { data: campaign, error: cErr } = await supabase
      .from("mtproto_campaigns")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        message_text: input.message,
        delay_min_seconds: input.delayMin,
        delay_max_seconds: input.delayMax,
        total_targets: totalTargets,
        status: "draft",
        failed_count: invalid.length,
        recurrence_hours: recurrenceHours,
        is_global: false,
      })
      .select("id")
      .single();
    if (cErr) return { ok: false, error: cErr.message };

    const rows: Array<Record<string, unknown>> = [
      ...valid.map((t) => ({
        campaign_id: campaign.id,
        target_identifier: t.identifier,
        target_type: t.type,
        status: "pending" as const,
      })),
      ...invalid.map((t) => ({
        campaign_id: campaign.id,
        target_identifier: t.identifier,
        target_type: t.type,
        status: "failed" as const,
        error_message: "invalid_identifier",
      })),
      ...dialogRows.map((d) => ({
        campaign_id: campaign.id,
        target_identifier: d.username ?? d.title ?? d.id,
        target_type: "username" as const,
        status: "pending" as const,
        dialog_id: d.id,
        account_id: d.account_id,
      })),
    ];
    if (rows.length) {
      const { error: tErr } = await supabase.from("mtproto_targets").insert(rows);
      if (tErr) return { ok: false, error: `Insert targets failed: ${tErr.message}` };
    }

    revalidatePath("/dashboard/automations");
    return { ok: true, campaignId: campaign.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createCampaign] unexpected:", err);
    return { ok: false, error: msg };
  }
}

export async function syncAccountDialogs(accountId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, tenant_id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!account) throw new Error("Conta não encontrada");
  await enqueueJob({ kind: "account.sync-dialogs", accountId });
  revalidatePath("/dashboard/automations");
}

export async function listAccountDialogs(
  accountId: string,
  filter?: { kinds?: string[]; search?: string },
): Promise<Array<{
  id: string;
  title: string | null;
  username: string | null;
  kind: string;
  peer_type: string;
  is_bot: boolean;
}>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  // Garante que a conta pertence ao tenant
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!account) return [];

  let q = supabase
    .from("mtproto_dialogs")
    .select("id, title, username, kind, peer_type, is_bot")
    .eq("account_id", accountId)
    .order("title", { ascending: true, nullsFirst: false })
    .limit(2000);

  if (filter?.kinds && filter.kinds.length > 0) {
    q = q.in("kind", filter.kinds);
  }
  if (filter?.search && filter.search.trim()) {
    q = q.ilike("title", `%${filter.search.trim()}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    title: string | null;
    username: string | null;
    kind: string;
    peer_type: string;
    is_bot: boolean;
  }>;
}

export async function listActiveAccounts(): Promise<Array<{
  id: string;
  display_name: string | null;
  phone_number: string;
}>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string }>;
}

export async function launchCampaign(campaignId: string): Promise<void> {
  await requireOwner();
  await enqueueJob({ kind: "campaign.run", campaignId });
  const supabase = await createClient();
  await supabase
    .from("mtproto_campaigns")
    .update({ status: "running" })
    .eq("id", campaignId);
  revalidatePath("/dashboard/automations");
  revalidatePath(`/dashboard/automations/campaigns/${campaignId}`);
}

async function postBotServer(path: string, body: unknown): Promise<Response> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  return fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function openMtprotoInbox(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  // RLS guard: garante que a conta é do tenant
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!data) return { ok: false, error: "account not found" };
  const res = await postBotServer("/api/mtproto/inbox/open", { accountId });
  if (!res.ok) return { ok: false, error: `server returned ${res.status}` };
  return { ok: true };
}

export async function heartbeatMtprotoInbox(accountId: string): Promise<void> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!data) return;
  await postBotServer("/api/mtproto/inbox/heartbeat", { accountId });
}

export async function closeMtprotoInbox(accountId: string): Promise<void> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!data) return;
  await postBotServer("/api/mtproto/inbox/close", { accountId });
}

export async function listInboxMessages(
  accountId: string,
): Promise<Array<{ id: string; tg_message_id: number; text: string | null; received_at: string; from_peer_name: string | null }>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!account) return [];
  const { data } = await supabase
    .from("mtproto_incoming_messages")
    .select("id, tg_message_id, text, received_at, from_peer_name")
    .eq("account_id", accountId)
    .order("received_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

/**
 * Pausa imediata: marca status='paused' no DB. O runner verifica isso entre
 * cada envio e aborta o loop. Targets pending continuam pending e podem ser
 * retomados com launchCampaign. Recorrência também é pausada (não dispara
 * próximo ciclo enquanto status='paused').
 */
export async function pauseCampaign(campaignId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase
    .from("mtproto_campaigns")
    .update({ status: "paused" })
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);
  revalidatePath("/dashboard/automations");
  revalidatePath(`/dashboard/automations/campaigns/${campaignId}`);
}

/**
 * Apaga a campanha permanentemente. Targets/dialogs ligados caem por
 * cascade (FK on delete cascade). Se a campanha estava running, o runner
 * vê o registro sumir no próximo getCampaignStatus e aborta.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("mtproto_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations");
}
