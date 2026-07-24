"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/actions/owner-actions";
import { deriveDestKind, isClonableKind } from "@/lib/mtproto/clone-kind";

async function currentTenantId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

async function enqueueClone(cloneJobId: string): Promise<void> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  const res = await fetch(`${serverUrl}/api/mtproto/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "clone.run", cloneJobId }),
  });
  if (!res.ok) throw new Error(`Falha ao enfileirar clone (${res.status})`);
}

export type SaveBotResult = { ok: true; username: string } | { ok: false; error: string };

/**
 * Valida o token no Telegram antes de salvar. O erro comum é o owner colar o
 * token errado e só descobrir quando o clone falha na mensagem 1.
 */
export async function saveAutomationBot(token: string): Promise<SaveBotResult> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const clean = token.trim();
  if (!clean) return { ok: false, error: "Cole o token do BotFather." };

  let me: { id: number; username?: string; is_bot: boolean };
  try {
    const res = await fetch(`https://api.telegram.org/bot${clean}/getMe`);
    const body = (await res.json()) as { ok: boolean; result?: typeof me; description?: string };
    if (!body.ok || !body.result) {
      return { ok: false, error: body.description ?? "Token recusado pelo Telegram." };
    }
    me = body.result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!me.is_bot) return { ok: false, error: "Esse token não é de um bot." };
  if (!me.username) {
    return { ok: false, error: "O bot precisa de @username para ser promovido a admin." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("automation_bots").upsert(
    {
      tenant_id: tenantId,
      token: clean,
      bot_user_id: String(me.id),
      username: me.username,
      session_string: null,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/automations");
  return { ok: true, username: me.username };
}

export async function removeAutomationBot(): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase.from("automation_bots").delete().eq("tenant_id", tenantId);
  revalidatePath("/dashboard/automations");
}

export type CreateCloneResult =
  | { ok: true; cloneJobId: string }
  | { ok: false; error: string };

export async function createCloneJob(input: {
  dialogId: string;
  destTitle: string;
  copyIdentity: boolean;
  messageLimit: number | null;
  throttleMs: number;
  copyReplies: boolean;
  copyPins: boolean;
  copyButtons: boolean;
  copyPolls: boolean;
}): Promise<CreateCloneResult> {
  try {
    await requireOwner();
    const tenantId = await currentTenantId();
    const supabase = await createClient();

    const { data: bot } = await supabase
      .from("automation_bots")
      .select("id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!bot) {
      return { ok: false, error: "Cadastre o bot companheiro antes de clonar." };
    }

    const { data: dialog } = await supabase
      .from("mtproto_dialogs")
      .select("id, account_id, peer_id, peer_type, peer_access_hash, kind, title, mtproto_accounts!inner(tenant_id)")
      .eq("id", input.dialogId)
      .eq("mtproto_accounts.tenant_id", tenantId)
      .single();
    if (!dialog) return { ok: false, error: "Origem não encontrada." };
    if (!isClonableKind(dialog.kind)) {
      return { ok: false, error: "Só dá para clonar canal ou grupo." };
    }
    if (input.messageLimit !== null && (input.messageLimit < 1 || input.messageLimit > 50000)) {
      return { ok: false, error: "O limite de mensagens vai de 1 a 50.000." };
    }

    const { data: job, error } = await supabase
      .from("clone_jobs")
      .insert({
        tenant_id: tenantId,
        account_id: dialog.account_id,
        source_dialog_id: dialog.id,
        source_peer_id: dialog.peer_id,
        source_peer_type: dialog.peer_type,
        source_peer_access_hash: dialog.peer_access_hash,
        source_title: dialog.title,
        dest_kind: deriveDestKind(dialog.kind),
        dest_title: input.destTitle.trim() || `${dialog.title ?? "Clone"} (clone)`,
        copy_identity: input.copyIdentity,
        message_limit: input.messageLimit,
        throttle_ms: input.throttleMs,
        copy_replies: input.copyReplies,
        copy_pins: input.copyPins,
        copy_buttons: input.copyButtons,
        copy_polls: input.copyPolls,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    revalidatePath("/dashboard/automations");
    return { ok: true, cloneJobId: job.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createCloneJob] unexpected:", err);
    return { ok: false, error: msg };
  }
}

export async function launchClone(cloneJobId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase
    .from("clone_jobs")
    .update({ status: "running", last_error: null })
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  await enqueueClone(cloneJobId);
  revalidatePath("/dashboard/automations");
  revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
}

/** Pausa: o runner checa o status entre cada grupo e aborta. O cursor fica salvo. */
export async function pauseClone(cloneJobId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase
    .from("clone_jobs")
    .update({ status: "paused" })
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
}

export async function deleteClone(cloneJobId: string): Promise<void> {
  await requireOwner();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await supabase.from("clone_jobs").delete().eq("id", cloneJobId).eq("tenant_id", tenantId);
  revalidatePath("/dashboard/automations");
}

/** Relatório: o que foi pulado, agrupado por motivo. */
export async function listCloneSkipReport(
  cloneJobId: string,
): Promise<Array<{ reason: string; count: number }>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("clone_jobs")
    .select("id")
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!job) return [];

  const { data } = await supabase
    .from("clone_message_map")
    .select("reason")
    .eq("job_id", cloneJobId)
    .in("status", ["skipped", "failed"])
    .limit(5000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row.reason ?? "desconhecido";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
