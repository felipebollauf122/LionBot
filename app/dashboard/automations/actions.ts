"use server";

import { createClient } from "@/lib/supabase/server";
import { parseTargets } from "@/lib/mtproto/target-parser";
import { revalidatePath } from "next/cache";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";

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

/**
 * Roda `corpo` atrás da checagem de acesso, sem deixar NADA escapar como
 * `throw` — mesma convenção (e mesmo motivo) de `comGuarda` em
 * `clones/actions.ts` e `scheduled/actions.ts`: erro LANÇADO de dentro de uma
 * Server Action é apagado pelo Next em produção e chega ao usuário como
 * "An error occurred in the Server Components render...". Recusa prevista
 * (env faltando, worker fora do ar, conta de outro tenant) é DADO.
 *
 * (Não é importado de lá porque um módulo "use server" só pode exportar
 * função async.)
 */
async function comGuarda<T extends { ok: boolean }>(
  acao: string,
  corpo: () => Promise<T | { ok: false; error: string }>,
): Promise<T | { ok: false; error: string }> {
  try {
    await requireAutomationsAccess();
  } catch {
    return { ok: false, error: "Seu plano não inclui as automações do Telegram." };
  }

  try {
    return await corpo();
  } catch (err) {
    console.error(`[${acao}] erro inesperado:`, err);
    return { ok: false, error: "Não foi possível concluir a ação. Tente de novo." };
  }
}

/**
 * Devolve a recusa do worker como dado. O `fetch` em si também é capturado:
 * worker fora do ar vira `TypeError: fetch failed`, que em produção chegaria
 * ao usuário apagado — e sem dizer que o problema é o servidor, não a conta.
 */
async function enqueueJob(job: MtprotoJob): Promise<{ ok: true } | { ok: false; error: string }> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/mtproto/enqueue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // A rota do worker exige segredo compartilhado desde que passou a
        // aceitar jobs de publicação e de LLM (server/src/index.ts): ela
        // despacha pra handlers de SERVICE ROLE que confiam no id recebido.
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify(job),
    });
  } catch (err) {
    console.error("[enqueueJob] servidor de automações inacessível:", err);
    return {
      ok: false,
      error: "O servidor de automações não respondeu. Confira se o worker está no ar e se NEXT_PUBLIC_BOT_SERVER_URL aponta pra ele.",
    };
  }
  if (!res.ok) {
    // 401 e 503 são causas DIFERENTES e o texto único mandava o operador
    // conferir os dois lados quando só um estava errado:
    //   503 = o worker subiu sem INTERNAL_API_SECRET (env não chegou no
    //         container; em Docker o env_file é o `.env` da RAIZ);
    //   401 = os dois têm segredo, mas são bytes diferentes — típico de
    //         aspas copiadas junto do .env, espaço no fim, ou `$` que o
    //         shell expandiu antes de gravar.
    return {
      ok: false,
      error:
        res.status === 503
          ? "O servidor de automações subiu sem INTERNAL_API_SECRET. Defina a variável no env que o worker lê e reinicie-o."
          : res.status === 401
            ? "O painel e o servidor de automações estão com INTERNAL_API_SECRET diferentes. Copie o mesmo valor nos dois, sem aspas nem espaços, e publique o painel de novo."
            : `Falha ao enfileirar job (${res.status})`,
    };
  }
  return { ok: true };
}

export type AddAccountResult = { ok: true; accountId: string } | { ok: false; error: string };

export async function startAddAccount(
  phoneNumber: string,
  displayName: string,
  actingTenantId?: string,
): Promise<AddAccountResult> {
  return comGuarda("startAddAccount", async (): Promise<AddAccountResult> => {
    const tenantId = await resolveActingTenantId(actingTenantId);
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
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Não foi possível criar a conta." };
    }
    // Depois desta linha a conta EXISTE. Uma recusa do enqueue não pode
    // apagá-la da resposta: a tela precisa do id pra continuar o login
    // assim que o worker voltar.
    const fila = await enqueueJob({ kind: "auth.request-code", accountId: data.id, phoneNumber });
    revalidatePath("/dashboard/automations", "layout");
    if (!fila.ok) return fila;
    return { ok: true, accountId: data.id };
  });
}

export async function submitAuthCode(
  accountId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return comGuarda("submitAuthCode", async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("mtproto_accounts")
      .select("phone_number")
      .eq("id", accountId)
      .single();
    if (!data) return { ok: false as const, error: "Conta não encontrada." };
    const fila = await enqueueJob({
      kind: "auth.sign-in",
      accountId,
      phoneNumber: data.phone_number,
      code,
    });
    revalidatePath("/dashboard/automations", "layout");
    return fila;
  });
}

export async function submitAuthPassword(
  accountId: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return comGuarda("submitAuthPassword", async () => {
    const fila = await enqueueJob({ kind: "auth.submit-password", accountId, password });
    revalidatePath("/dashboard/automations", "layout");
    return fila;
  });
}

export async function removeAccount(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return comGuarda("removeAccount", async () => {
    const supabase = await createClient();
    // `delete` sem linha atingida não vira `error` no supabase-js: sem o
    // `select`, uma conta de outro tenant (barrada pela RLS) sumiria em
    // silêncio e a tela recarregaria como se tivesse apagado.
    const { data, error } = await supabase
      .from("mtproto_accounts")
      .delete()
      .eq("id", accountId)
      .select("id");
    if (error) return { ok: false as const, error: error.message };
    if (!data?.length) return { ok: false as const, error: "Conta não encontrada." };
    revalidatePath("/dashboard/automations", "layout");
    return { ok: true as const };
  });
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
  recurrenceMinutes?: number | null;
  global?: boolean;
  actingTenantId?: string;
}): Promise<CreateCampaignResult> {
  try {
    await requireAutomationsAccess();
    const tenantId = await resolveActingTenantId(input.actingTenantId);
    const supabase = await createClient();

    let recurrenceMinutes: number | null = null;
    if (input.recurrenceMinutes != null && input.recurrenceMinutes > 0) {
      recurrenceMinutes = Math.floor(input.recurrenceMinutes);
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
          recurrence_minutes: recurrenceMinutes,
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

      revalidatePath("/dashboard/automations", "layout");
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
        recurrence_minutes: recurrenceMinutes,
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

    revalidatePath("/dashboard/automations", "layout");
    return { ok: true, campaignId: campaign.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createCampaign] unexpected:", err);
    return { ok: false, error: msg };
  }
}

export async function syncAccountDialogs(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return comGuarda("syncAccountDialogs", async () => {
    const supabase = await createClient();
    // Sem filtro de tenant_id: a RLS de mtproto_accounts (tenant_id = auth.uid()
    // OR is_admin()) já garante que só vê/afeta conta própria ou, se admin, de
    // qualquer tenant — é o que permite o seletor "Minha/Todos/Usuário" agir.
    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("id")
      .eq("id", accountId)
      .single();
    if (!account) return { ok: false as const, error: "Conta não encontrada." };
    const fila = await enqueueJob({ kind: "account.sync-dialogs", accountId });
    revalidatePath("/dashboard/automations", "layout");
    return fila;
  });
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
  const supabase = await createClient();
  // Sem filtro de tenant_id — RLS de mtproto_accounts cobre (própria ou, se
  // admin, qualquer tenant).
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
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

export async function listActiveAccounts(actingTenantId?: string): Promise<Array<{
  id: string;
  display_name: string | null;
  phone_number: string;
}>> {
  const tenantId = await resolveActingTenantId(actingTenantId);
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

export async function launchCampaign(
  campaignId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return comGuarda("launchCampaign", async () => {
    // A marcação `running` só depois da fila aceitar: antes o enqueue lançava
    // e a atualização nem acontecia. Agora que a recusa volta como dado, uma
    // campanha enfileirada com sucesso ZERO não pode ficar exibida como em
    // andamento — ninguém a retomaria.
    const fila = await enqueueJob({ kind: "campaign.run", campaignId });
    if (!fila.ok) return fila;
    const supabase = await createClient();
    await supabase
      .from("mtproto_campaigns")
      .update({ status: "running" })
      .eq("id", campaignId);
    revalidatePath("/dashboard/automations", "layout");
    revalidatePath(`/dashboard/automations/campaigns/${campaignId}`);
    return { ok: true as const };
  });
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
  const supabase = await createClient();
  // RLS guard: mtproto_accounts só deixa ver a própria conta ou, se admin, qualquer uma.
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .single();
  if (!data) return { ok: false, error: "account not found" };
  const res = await postBotServer("/api/mtproto/inbox/open", { accountId });
  if (!res.ok) return { ok: false, error: `server returned ${res.status}` };
  return { ok: true };
}

export async function heartbeatMtprotoInbox(accountId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .single();
  if (!data) return;
  await postBotServer("/api/mtproto/inbox/heartbeat", { accountId });
}

export async function closeMtprotoInbox(accountId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
    .single();
  if (!data) return;
  await postBotServer("/api/mtproto/inbox/close", { accountId });
}

export async function listInboxMessages(
  accountId: string,
): Promise<Array<{ id: string; tg_message_id: number; text: string | null; received_at: string; from_peer_name: string | null }>> {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("id", accountId)
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
  await requireAutomationsAccess();
  const supabase = await createClient();
  // Sem filtro de tenant_id — RLS de mtproto_campaigns cobre.
  await supabase
    .from("mtproto_campaigns")
    .update({ status: "paused" })
    .eq("id", campaignId);
  revalidatePath("/dashboard/automations", "layout");
  revalidatePath(`/dashboard/automations/campaigns/${campaignId}`);
}

/**
 * Apaga a campanha permanentemente. Targets/dialogs ligados caem por
 * cascade (FK on delete cascade). Se a campanha estava running, o runner
 * vê o registro sumir no próximo getCampaignStatus e aborta.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  await requireAutomationsAccess();
  const supabase = await createClient();
  // Sem filtro de tenant_id — RLS de mtproto_campaigns cobre.
  const { error } = await supabase
    .from("mtproto_campaigns")
    .delete()
    .eq("id", campaignId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations", "layout");
}
