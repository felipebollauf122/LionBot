"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
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
  await requireAutomationsAccess();
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
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase.from("automation_bots").delete().eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations");
}

export type CreateCloneResult =
  | { ok: true; cloneJobId: string }
  | { ok: false; error: string };

/** Vazio vira null (categoria não é trocada); '@' na frente do bot é ignorado. */
function normalizeLinkReplace(raw: string, stripAt = false): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return stripAt ? trimmed.replace(/^@/, "") : trimmed;
}

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
  /** Conta que cria o destino. Omitido/igual à origem = mesma conta. */
  destAccountId?: string;
  /** Username sem @ pra trocar todo bot mencionado/linkado no conteúdo clonado. Vazio = não troca. */
  linkReplaceBot: string;
  /** Link pra trocar todo grupo mencionado/linkado. Vazio = não troca. */
  linkReplaceGroup: string;
  /** Link pra trocar todo canal mencionado/linkado. Vazio = não troca. */
  linkReplaceChannel: string;
}): Promise<CreateCloneResult> {
  try {
    await requireAutomationsAccess();
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

    // Conta que cria o destino: default = a mesma da origem. Se for outra,
    // valida que é do tenant, ativa e NÃO restrita (senão o createChannel
    // falharia com USER_RESTRICTED).
    const destAccountId = input.destAccountId?.trim() || dialog.account_id;
    if (destAccountId !== dialog.account_id) {
      const { data: destAcc } = await supabase
        .from("mtproto_accounts")
        .select("id, status, create_restricted")
        .eq("id", destAccountId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!destAcc || destAcc.status !== "active") {
        return { ok: false, error: "A conta de destino não existe ou não está ativa." };
      }
      if (destAcc.create_restricted) {
        return { ok: false, error: "A conta de destino está restrita e não cria canais. Escolha outra." };
      }
    }

    const { data: job, error } = await supabase
      .from("clone_jobs")
      .insert({
        tenant_id: tenantId,
        account_id: dialog.account_id,
        dest_account_id: destAccountId,
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
        link_replace_bot: normalizeLinkReplace(input.linkReplaceBot, true),
        link_replace_group: normalizeLinkReplace(input.linkReplaceGroup),
        link_replace_channel: normalizeLinkReplace(input.linkReplaceChannel),
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
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("clone_jobs")
    .update({ status: "running", last_error: null })
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Job de outro tenant (ou inexistente) não bate nenhuma linha: não pode
  // disparar o worker externo, que só recebe o id e confiaria cegamente nele.
  if (!updated) return;
  await enqueueClone(cloneJobId);
  revalidatePath("/dashboard/automations");
  revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
}

/** Pausa: o runner checa o status entre cada grupo e aborta. O cursor fica salvo. */
export async function pauseClone(cloneJobId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clone_jobs")
    .update({ status: "paused" })
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
}

export async function deleteClone(cloneJobId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("clone_jobs")
    .delete()
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
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

/**
 * Contas que podem CRIAR o destino de um clone: ativas e não-restritas pelo
 * anti-spam do Telegram (create_restricted=false). Alimenta o seletor "criar
 * destino em" do formulário de clone.
 */
export async function listEligibleDestAccounts(): Promise<
  Array<{ id: string; display_name: string | null; phone_number: string }>
> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("create_restricted", false)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string }>;
}

/**
 * Limpa o flag create_restricted de uma conta — pro owner usar depois de
 * resolver a restrição no @SpamBot. Owner-only, escopado por tenant.
 */
export async function clearAccountRestriction(accountId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("mtproto_accounts")
    .update({ create_restricted: false })
    .eq("id", accountId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations");
}
