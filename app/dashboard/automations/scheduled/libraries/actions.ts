"use server";

import { createClient } from "@/lib/supabase/server";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { revalidatePath } from "next/cache";
import {
  defaultLibraryRules, validateLibraryRules, validLibraryUrl,
  type AutomationLibrary, type LibraryRules, type LibraryResult, type LibraryDialog, type LibraryContent,
} from "@/lib/automations/library-types";

const BASE = "/dashboard/automations/scheduled";
function refresh(id?: string) {
  revalidatePath(BASE, "layout");
  if (id) revalidatePath(`${BASE}/libraries/${id}`, "layout");
}
async function guarded(fn: () => Promise<LibraryResult>): Promise<LibraryResult> {
  try { await requireAutomationsAccess(); }
  catch { return { ok: false, error: "Entre em uma conta com acesso às automações." }; }
  try { return await fn(); }
  catch (error) {
    console.error("[library-action]", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "Não foi possível concluir. Confira a conexão e tente novamente." };
  }
}
async function ownedLibrary(id: string) {
  const db = await createClient();
  const { data, error } = await db.from("automation_libraries").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as AutomationLibrary;
}
async function ownedDialog(id: string, tenantId: string, destination = false) {
  const db = await createClient();
  let query = db.from("mtproto_dialogs").select("id, peer_id, peer_type, title, kind, account_id, mtproto_accounts!inner(tenant_id, status)")
    .eq("id", id).eq("mtproto_accounts.tenant_id", tenantId)
    .eq("mtproto_accounts.status", "active").in("peer_type", ["channel", "chat"]);
  if (destination) query = query.in("kind", ["channel_owner", "group_admin"]);
  const { data, error } = await query.maybeSingle();
  return error ? null : data;
}

export async function listLibraryDialogs(actingTenantId?: string, destination = false): Promise<LibraryDialog[]> {
  await requireAutomationsAccess();
  if (actingTenantId === "all") return [];
  const tenantId = await resolveActingTenantId(actingTenantId);
  const db = await createClient();
  const result: LibraryDialog[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = db.from("mtproto_dialogs")
      .select("id, title, peer_id, peer_type, mtproto_accounts!inner(tenant_id, status, display_name, phone_number)")
      .eq("mtproto_accounts.tenant_id", tenantId).eq("mtproto_accounts.status", "active")
      .in("peer_type", ["channel", "chat"]).order("id").range(offset, offset + 499);
    if (destination) query = query.in("kind", ["channel_owner", "group_admin"]);
    const { data, error } = await query;
    if (error) throw new Error("Não foi possível carregar os canais e grupos.");
    for (const row of data ?? []) {
      const account = (Array.isArray(row.mtproto_accounts) ? row.mtproto_accounts[0] : row.mtproto_accounts) as { display_name: string | null; phone_number: string };
      result.push({ id: row.id, title: row.title || row.peer_id, peer_id: row.peer_id, peer_type: row.peer_type, account: account?.display_name || account?.phone_number || "" });
    }
    if (!data || data.length < 500) break;
  }
  return result;
}

export async function createLibrary(input: { name: string; destDialogId: string; actingTenantId?: string }): Promise<LibraryResult> {
  return guarded(async () => {
    if (input.actingTenantId === "all") return { ok: false, error: "Escolha um usuário para criar a automação." };
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) return { ok: false, error: "Informe um nome de até 120 caracteres." };
    const tenantId = await resolveActingTenantId(input.actingTenantId);
    if (!await ownedDialog(input.destDialogId, tenantId, true)) return { ok: false, error: "Escolha um canal ou grupo administrado por uma conta conectada deste usuário." };
    const db = await createClient();
    const { data, error } = await db.from("automation_libraries").insert({
      tenant_id: tenantId, name: input.name.trim(), dest_dialog_id: input.destDialogId, rules: defaultLibraryRules, enabled: false,
    }).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "Este destino já possui um acervo. Abra a automação existente." : "Não foi possível criar o acervo. Confira se a atualização do banco foi aplicada." };
    refresh();
    return { ok: true, id: data.id };
  });
}

export async function saveLibraryRules(id: string, rules: LibraryRules): Promise<LibraryResult> {
  return guarded(async () => {
    const invalid = validateLibraryRules(rules);
    if (invalid) return { ok: false, error: invalid };
    const library = await ownedLibrary(id);
    if (!library) return { ok: false, error: "Acervo não encontrado ou sem acesso." };
    if (library.enabled) return { ok: false, error: "Pause a automação antes de alterar as regras." };
    const db = await createClient();
    const { data, error } = await db.from("automation_libraries")
      .update({ rules, updated_at: new Date().toISOString(), next_send_at: null })
      .eq("id", id).eq("enabled", false).select("id");
    if (error || !data?.length) return { ok: false, error: "As regras não foram salvas. Confira se a automação está pausada." };
    refresh(id);
    return { ok: true };
  });
}

export async function setLibraryEnabled(id: string, enabled: boolean): Promise<LibraryResult> {
  return guarded(async () => {
    if (typeof enabled !== "boolean") return { ok: false, error: "Estado inválido." };
    const library = await ownedLibrary(id);
    if (!library) return { ok: false, error: "Acervo não encontrado ou sem acesso." };
    const db = await createClient();
    if (enabled) {
      if (!library.dest_dialog_id || !await ownedDialog(library.dest_dialog_id, library.tenant_id, true)) return { ok: false, error: "O destino não está mais disponível. Reconecte e sincronize a conta do Telegram." };
      const { data: bot } = await db.from("automation_bots").select("id").eq("tenant_id", library.tenant_id).maybeSingle();
      if (!bot) return { ok: false, error: "Configure o bot de publicação antes de ativar." };
      const invalid = validateLibraryRules({ ...defaultLibraryRules, ...library.rules });
      if (invalid) return { ok: false, error: invalid };
    }
    const { data, error } = await db.from("automation_libraries").update({ enabled, updated_at: new Date().toISOString(), last_error: null }).eq("id", id).select("id");
    if (error || !data?.length) return { ok: false, error: "Não foi possível alterar o estado da automação." };
    refresh(id);
    return { ok: true };
  });
}

export async function addLibrarySource(libraryId: string, input: { dialogId: string; importHistory: boolean; watch: boolean }): Promise<LibraryResult> {
  return guarded(async () => {
    const library = await ownedLibrary(libraryId);
    if (!library) return { ok: false, error: "Acervo não encontrado ou sem acesso." };
    if (typeof input.importHistory !== "boolean" || typeof input.watch !== "boolean" || (!input.importHistory && !input.watch)) return { ok: false, error: "Selecione importar histórico, monitorar novas postagens ou ambos." };
    const source = await ownedDialog(input.dialogId, library.tenant_id);
    const dest = library.dest_dialog_id ? await ownedDialog(library.dest_dialog_id, library.tenant_id, true) : null;
    if (!source || !dest) return { ok: false, error: "Origem ou destino indisponível. Sincronize as contas e tente novamente." };
    if (source.peer_id === dest.peer_id && source.peer_type === dest.peer_type) return { ok: false, error: "A origem não pode ser o próprio destino." };
    const db = await createClient();
    const { data, error } = await db.from("automation_library_sources").insert({
      library_id: libraryId, tenant_id: library.tenant_id, source_dialog_id: input.dialogId,
      import_history: input.importHistory, watch: input.watch, status: "pending",
    }).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "Esta origem já está neste acervo." : "Não foi possível adicionar a origem." };
    refresh(libraryId);
    return { ok: true, id: data.id };
  });
}

export async function setLibrarySourcePaused(libraryId: string, sourceId: string, paused: boolean): Promise<LibraryResult> {
  return guarded(async () => {
    if (typeof paused !== "boolean") return { ok: false, error: "Estado inválido." };
    if (!await ownedLibrary(libraryId)) return { ok: false, error: "Acervo não encontrado ou sem acesso." };
    const db = await createClient();
    const { data, error } = await db.from("automation_library_sources")
      .update({ status: paused ? "paused" : "pending", last_error: null })
      .eq("id", sourceId).eq("library_id", libraryId).select("id");
    if (error || !data?.length) return { ok: false, error: "Não foi possível alterar a origem." };
    refresh(libraryId);
    return { ok: true };
  });
}

export async function updateLibraryItem(libraryId: string, itemId: string, input: {
  action: "save" | "queue" | "reprocess" | "reuse" | "discard" | "retry";
  text?: string; buttons?: Array<{ text: string; url: string }>; scheduledAt?: string;
}): Promise<LibraryResult> {
  return guarded(async () => {
    const library = await ownedLibrary(libraryId);
    if (!library) return { ok: false, error: "Acervo não encontrado ou sem acesso." };
    const db = await createClient();
    const { data: item } = await db.from("automation_library_items").select("*").eq("id", itemId).eq("library_id", libraryId).maybeSingle();
    if (!item) return { ok: false, error: "Mensagem não encontrada neste acervo." };
    if (item.last_error?.startsWith("album_member:")) return { ok: false, error: "Edite a postagem principal do álbum." };
    if (item.status === "processing" || item.delivery_status === "sending") return { ok: false, error: "Esta mensagem está sendo processada ou enviada. Aguarde." };
    if (item.delivery_status === "sent" && input.action !== "reuse") return { ok: false, error: "Use Reutilizar para preparar um novo envio deste item do acervo." };
    const patch: Record<string, unknown> = { last_error: null };
    if (item.delivery_receipts?.length && item.delivery_status !== "sent" && input.action !== "retry") return { ok: false, error: "Esta postagem já foi parcialmente enviada. Continue as etapas pendentes sem alterar seu conteúdo." };
    if (input.action === "reprocess" || input.action === "reuse") {
      Object.assign(patch, { status: "pending", processed: null, delivery_status: "draft", scheduled_at: null, attempts: 0, sent_at: null, dest_message_id: null, delivery_receipts: [], delivery_claimed_at: null });
    } else if (input.action === "retry") {
      if (item.delivery_status !== "failed" || !item.processed) return { ok: false, error: "Esta postagem não está disponível para retomar." };
      Object.assign(patch, { delivery_status: "pending", scheduled_at: new Date().toISOString(), delivery_claimed_at: null });
    } else if (input.action === "discard") {
      Object.assign(patch, { status: "skipped", delivery_status: "draft", scheduled_at: null });
    } else if (input.action === "save" || input.action === "queue") {
      if (!["ready","skipped"].includes(item.status)) return { ok: false, error: "Aguarde o tratamento da mensagem ou tente processá-la novamente." };
      const content = { ...(item.processed || item.original) } as LibraryContent;
      if (input.text !== undefined) {
        const max = content.poll ? 300 : content.media?.length ? 1024 : 4096;
        if (typeof input.text !== "string" || input.text.length > max) return { ok: false, error: `Este conteúdo aceita até ${max} caracteres.` };
        content.content_text = input.text;
        if (content.poll) content.poll = { ...content.poll, question: input.text };
        content.entities = null;
      }
      if (input.buttons !== undefined) {
        if (!Array.isArray(input.buttons) || input.buttons.length > 20 || input.buttons.some((b) => !b || typeof b.text !== "string" || !b.text.trim() || b.text.length > 64 || !validLibraryUrl(b.url))) return { ok: false, error: "Revise os textos e links dos botões." };
        content.buttons = input.buttons;
        content.inline_links = input.buttons;
      }
      if (!content.content_text?.trim() && !content.media?.length && !content.poll) return { ok: false, error: "A mensagem precisa de texto, mídia ou enquete." };
      content.discard = false;
      Object.assign(patch, { processed: content, status: "ready", delivery_status: "draft", scheduled_at: null });
      if (input.action === "queue") {
        const when = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
        if (!Number.isFinite(when.getTime())) return { ok: false, error: "Horário inválido." };
        Object.assign(patch, { delivery_status: "pending", scheduled_at: when.toISOString(), attempts: 0 });
      }
    } else return { ok: false, error: "Ação inválida." };
    const { data, error } = await db.from("automation_library_items").update(patch)
      .eq("id", itemId).eq("library_id", libraryId).eq("status", item.status).eq("delivery_status", item.delivery_status).select("id");
    if (error || !data?.length) return { ok: false, error: "A mensagem mudou durante a edição. Atualize a tela." };
    refresh(libraryId);
    return { ok: true };
  });
}

export async function reprocessLibraryDrafts(libraryId: string): Promise<LibraryResult> {
  return guarded(async () => {
    const library = await ownedLibrary(libraryId);
    if (!library) return { ok: false, error: "Acervo não encontrado ou sem acesso." };
    if (library.enabled) return { ok: false, error: "Pause a automação antes de reprocessar os rascunhos." };
    const db = await createClient();
    const { error } = await db.from("automation_library_items")
      .update({ status: "pending", processed: null, last_error: null })
      .eq("library_id", libraryId).eq("delivery_status", "draft").in("status", ["ready","skipped","failed"]);
    if (error) return { ok: false, error: "Não foi possível reprocessar o acervo." };
    refresh(libraryId);
    return { ok: true };
  });
}

export async function resolveLibraryDelivery(libraryId: string, itemId: string, outcome: "sent" | "retry"): Promise<LibraryResult> {
  return guarded(async () => {
    if (!["sent","retry"].includes(outcome)) return { ok: false, error: "Resultado inválido." };
    const library = await ownedLibrary(libraryId);
    if (!library || library.enabled) return { ok: false, error: "Pause a automação antes de conferir o envio." };
    const db = await createClient();
    const { data: item } = await db.from("automation_library_items").select("*").eq("id",itemId).eq("library_id",libraryId).maybeSingle();
    if (!item || item.delivery_status !== "sending" || !item.delivery_claimed_at || Date.parse(item.delivery_claimed_at) > Date.now()-300_000) return { ok: false, error: "Aguarde cinco minutos após o início do envio antes de liberar uma nova tentativa." };
    const patch = outcome === "sent"
      ? { delivery_status: "sent", sent_at: new Date().toISOString(), last_error: "Conclusão conferida manualmente no Telegram." }
      : { delivery_status: "pending", scheduled_at: new Date().toISOString(), last_error: "Etapas sem confirmação liberadas manualmente." };
    const { data, error } = await db.from("automation_library_items").update({ ...patch, delivery_claimed_at: null })
      .eq("id",itemId).eq("library_id",libraryId).eq("delivery_status","sending").eq("delivery_claimed_at",item.delivery_claimed_at).select("id");
    if (error || !data?.length) return { ok: false, error: "O envio mudou durante a conferência. Atualize a tela." };
    refresh(libraryId);
    return { ok: true };
  });
}
