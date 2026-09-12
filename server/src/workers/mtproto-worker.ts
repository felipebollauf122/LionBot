import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";
import { supabase } from "../db.js";
import { MtprotoClient } from "../services/mtproto/client.js";
import { AccountPool, type PoolAccount } from "../services/mtproto/pool.js";
import {
  CampaignRunner,
  type CampaignTargetRow,
} from "../services/mtproto/campaign-runner.js";
import { enqueueMtproto, type MtprotoJobData } from "../queue-mtproto.js";
import { buildGlobalTargetRows, type GlobalDialogRow } from "../services/mtproto/global-targets.js";
import { sendWithForumFallback } from "../services/mtproto/forum-fallback.js";
import { handleCloneRun } from "./clone-handler.js";
import { handleBotCloneExplore, handleBotCloneBuildFlow } from "./bot-clone-handler.js";
import { handleScheduledSend } from "./scheduled-campaign-handler.js";
import { handleCampaignAiProcess } from "./campaign-ai-handler.js";

// Kinds elegíveis pra disparo global. Inclui grupos onde só participa — o
// owner aceita o risco de ban por spam em troca de alcance máximo.
// Exclui 'bot' (mandar pra bots é desperdício), 'self' (Saved Messages do
// próprio dono — ele já leu) e 'channel_subscriber': canal broadcast onde a
// conta só assina. Assinante NUNCA posta em broadcast — cada um desses era um
// CHAT_ADMIN_REQUIRED garantido, a maior fatia das "falhas" da tela.
// Espelhado em app/dashboard/automations/actions.ts.
const GLOBAL_DIALOG_KINDS = [
  "contact",
  "dm",
  "group_admin",
  "group_member",
  "channel_owner",
] as const;

// liveClients com TTL (#45): rastreia último uso pra evitar crescimento
// ilimitado de conexões MTProto. Um sweep periódico desconecta e remove
// clients ociosos há mais de IDLE_TTL_MS.
interface LiveClientEntry {
  client: MtprotoClient;
  lastUsed: number;
}
const liveClients = new Map<string, LiveClientEntry>();
const LIVE_CLIENT_IDLE_TTL_MS = 30 * 60 * 1000; // 30 min ocioso → desconecta

// Set de syncs em andamento (#51) — evita múltiplos handleSyncDialogs
// paralelos pra mesma conta (que floodariam a API do Telegram).
const inProgressSyncs = new Set<string>();

async function getOrCreateClient(accountId: string, sessionString: string): Promise<MtprotoClient> {
  const entry = liveClients.get(accountId);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.client;
  }
  const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, sessionString);
  await client.connect();
  liveClients.set(accountId, { client, lastUsed: Date.now() });
  return client;
}

/** Remove e desconecta clients ociosos (#45). Chamado por sweep + shutdown. */
async function sweepIdleClients(force = false): Promise<void> {
  const now = Date.now();
  for (const [accountId, entry] of liveClients) {
    if (force || now - entry.lastUsed > LIVE_CLIENT_IDLE_TTL_MS) {
      liveClients.delete(accountId);
      await entry.client.disconnect().catch(() => {});
    }
  }
}

/** Graceful shutdown (#46): desconecta todos os clients MTProto vivos. */
export async function shutdownMtprotoClients(): Promise<void> {
  console.log(`[mtproto] graceful shutdown — desconectando ${liveClients.size} clients`);
  await sweepIdleClients(true);
}

setInterval(() => {
  sweepIdleClients().catch((e) => console.error("[mtproto] sweep idle clients erro:", e));
}, 10 * 60 * 1000).unref?.();

async function updateAccount(accountId: string, patch: Record<string, unknown>): Promise<void> {
  await supabase
    .from("mtproto_accounts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", accountId);
}

async function notifyLoginBot(
  accountId: string,
  kind: "code_sent" | "needs_password" | "success" | "error",
  errorMsg?: string,
): Promise<void> {
  try {
    const handler = await import("../webhook/mtproto-login-handler.js");
    if (kind === "code_sent") await handler.notifyLoginCodeSent(accountId);
    else if (kind === "needs_password") await handler.notifyLoginNeedsPassword(accountId);
    else if (kind === "success") await handler.notifyLoginSuccess(accountId);
    else if (kind === "error") await handler.notifyLoginError(accountId, errorMsg ?? "unknown");
  } catch (err) {
    console.error(`[mtproto] notifyLoginBot(${kind}) failed for ${accountId}:`, err);
  }
}

async function handleRequestCode(accountId: string, phoneNumber: string): Promise<void> {
  const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash);
  try {
    const { phoneCodeHash } = await client.sendCode(phoneNumber);
    await supabase
      .from("mtproto_auth_sessions")
      .delete()
      .eq("account_id", accountId);
    await supabase.from("mtproto_auth_sessions").insert({
      account_id: accountId,
      phone_code_hash: phoneCodeHash,
      needs_password: false,
    });
    await updateAccount(accountId, { status: "code_sent", last_error: null });
    liveClients.set(accountId, { client, lastUsed: Date.now() });
    await notifyLoginBot(accountId, "code_sent");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAccount(accountId, { status: "disconnected", last_error: msg });
    await client.disconnect().catch(() => {});
    await notifyLoginBot(accountId, "error", msg);
    throw err;
  }
}

async function handleSignIn(accountId: string, phoneNumber: string, code: string): Promise<void> {
  const { data: session } = await supabase
    .from("mtproto_auth_sessions")
    .select("*")
    .eq("account_id", accountId)
    .single();
  if (!session) throw new Error("auth session not found");
  const client = liveClients.get(accountId)?.client;
  if (!client) throw new Error("client not live — re-solicite o código");

  try {
    const result = await client.signIn(phoneNumber, session.phone_code_hash, code);
    if (result.ok) {
      await updateAccount(accountId, {
        status: "active",
        session_string: result.sessionString,
        last_error: null,
      });
      await supabase.from("mtproto_auth_sessions").delete().eq("account_id", accountId);
      await enqueueMtproto({ kind: "account.sync-dialogs", accountId }).catch((err) =>
        console.error(`[mtproto] failed to enqueue initial sync for ${accountId}:`, err),
      );
      await notifyLoginBot(accountId, "success");
    } else if (result.needsPassword) {
      await supabase
        .from("mtproto_auth_sessions")
        .update({ needs_password: true })
        .eq("account_id", accountId);
      await updateAccount(accountId, { status: "needs_password" });
      await notifyLoginBot(accountId, "needs_password");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAccount(accountId, { last_error: msg });
    // Casos comuns/auto-recoveráveis: pede novo código transparente
    if (/PHONE_CODE_EXPIRED|PHONE_CODE_INVALID|PHONE_CODE_EMPTY/i.test(msg)) {
      try {
        const handler = await import("../webhook/mtproto-login-handler.js");
        await handler.notifyLoginRecoverableCodeError(accountId, msg);
      } catch (e) {
        console.error("[mtproto] recoverable code error notify failed:", e);
      }
      // Reenfileira request-code com o phoneNumber atual
      await enqueueMtproto({ kind: "auth.request-code", accountId, phoneNumber }).catch((e) =>
        console.error("[mtproto] reenqueue request-code failed:", e),
      );
      return; // não throw — é recuperável
    }
    await notifyLoginBot(accountId, "error", msg);
    throw err;
  }
}

async function handleSubmitPassword(accountId: string, password: string): Promise<void> {
  const client = liveClients.get(accountId)?.client;
  if (!client) throw new Error("client not live — re-solicite o código");
  try {
    const result = await client.signInWithPassword(password);
    if (result.ok) {
      await updateAccount(accountId, {
        status: "active",
        session_string: result.sessionString,
        last_error: null,
      });
      await supabase.from("mtproto_auth_sessions").delete().eq("account_id", accountId);
      await enqueueMtproto({ kind: "account.sync-dialogs", accountId }).catch((err) =>
        console.error(`[mtproto] failed to enqueue initial sync for ${accountId}:`, err),
      );
      await notifyLoginBot(accountId, "success");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAccount(accountId, { last_error: msg });
    await notifyLoginBot(accountId, "error", msg);
    throw err;
  }
}

async function handleSyncDialogs(accountId: string): Promise<void> {
  // Dedup (#51): se já tem um sync rodando pra essa conta, não inicia outro.
  // listDialogs é caro (30s+) e múltiplos em paralelo floodariam o Telegram.
  if (inProgressSyncs.has(accountId)) {
    console.log(`[mtproto.sync] account ${accountId} já está sincronizando — pulando`);
    return;
  }
  inProgressSyncs.add(accountId);
  try {
    await doSyncDialogs(accountId);
  } finally {
    inProgressSyncs.delete(accountId);
  }
}

async function doSyncDialogs(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (!account) {
    console.error(`[mtproto.sync] account ${accountId} not found`);
    return;
  }
  if (account.status !== "active" || !account.session_string) {
    console.error(`[mtproto.sync] account ${accountId} not authenticated (status=${account.status})`);
    return;
  }

  console.log(`[mtproto.sync] starting dialog sync for account ${accountId}`);

  let client: MtprotoClient;
  try {
    client = await getOrCreateClient(accountId, account.session_string);
  } catch (err) {
    console.error(`[mtproto.sync] failed to get client for ${accountId}:`, err);
    await updateAccount(accountId, {
      last_error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let dialogs;
  try {
    dialogs = await client.listDialogs();
  } catch (err) {
    console.error(`[mtproto.sync] listDialogs failed for ${accountId}:`, err);
    await updateAccount(accountId, {
      last_error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  console.log(`[mtproto.sync] account ${accountId}: fetched ${dialogs.length} dialogs`);

  // Substitui o conteúdo da tabela pra essa conta — sync é snapshot completo.
  // Não usamos delete+insert pra evitar perder dialog_ids referenciados por
  // mtproto_targets (FK on delete set null); upsert preserva ids existentes.
  const now = new Date().toISOString();
  const rows = dialogs.map((d) => ({
    account_id: accountId,
    peer_id: d.peerId,
    peer_type: d.peerType,
    peer_access_hash: d.peerAccessHash,
    kind: d.kind,
    title: d.title,
    username: d.username,
    is_bot: d.isBot,
    // Sobrescrito a cada sync (permissão mudou → volta a null). send_refusal e
    // forum_topic_id NÃO entram aqui de propósito: são sticky (o upsert só
    // toca nas colunas listadas).
    write_block: d.writeBlock,
    is_forum: d.isForum,
    last_synced_at: now,
  }));

  // Upsert em lotes de 500 pra evitar payload gigante
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("mtproto_dialogs")
      .upsert(batch, { onConflict: "account_id,peer_id,peer_type" });
    if (error) {
      console.error(`[mtproto.sync] upsert batch failed:`, error);
      await updateAccount(accountId, { last_error: `sync upsert failed: ${error.message}` });
      return;
    }
  }

  // Remove dialogs que não apareceram nesse sync (peer saiu da conta)
  if (rows.length > 0) {
    const peerKeys = rows.map((r) => `(${r.peer_type},${r.peer_id})`).join(",");
    // O Supabase Postgrest não tem `not in (tuple, tuple)`, então delete por última atualização:
    // tudo que NÃO foi atualizado nesse sync (last_synced_at < now) é removido.
    const { error: delErr } = await supabase
      .from("mtproto_dialogs")
      .delete()
      .eq("account_id", accountId)
      .lt("last_synced_at", now);
    if (delErr) {
      console.warn(`[mtproto.sync] stale dialog cleanup failed (non-fatal):`, delErr);
    }
    void peerKeys; // mantém log opcional pra debug
  }

  await updateAccount(accountId, { last_error: null });
  console.log(`[mtproto.sync] account ${accountId}: ${rows.length} dialogs synced`);

  // Hot-add: se essa conta tem owner_id (tenant) com campanhas globais
  // ativas/pausadas/agendadas, adiciona os dialogs dessa conta como targets
  // pending pra todas elas. Garante que conta nova sempre dispara em
  // campanhas em curso, mesmo se a campanha tava prestes a terminar.
  await addAccountToActiveGlobalCampaigns(accountId).catch((err) =>
    console.error(`[mtproto.hot-add] account ${accountId} falhou:`, err),
  );
}

/**
 * Pra cada campanha global ativa (running|scheduled|paused) do tenant da
 * conta, insere targets pending pros dialogs dessa conta em kinds seguros.
 * Se a campanha já tinha terminado (completed/failed), ignora — comportamento
 * estável: só campanhas "vivas" recebem hot-add.
 *
 * Se a campanha está em status completed mas ainda dentro do ciclo de
 * recorrência, o user já tem o próximo scheduled — então o hot-add cobre.
 *
 * Se a campanha estava running e o runner já terminou o snapshot atual,
 * o runner agora faz refetch ao acabar o loop (campaign-runner.ts) e pega
 * os novos targets antes de marcar completed.
 *
 * Se a campanha estava scheduled (próximo ciclo recorrente), o
 * refreshGlobalCampaignTargets do próximo handleCampaignRun vai
 * regenerar com base no DB atual — mas os pending que adicionamos aqui
 * serão deletados (ele faz delete + recreate). Pra evitar perda, marca
 * com um tag especial via account_id (já está).
 *
 * Comportamento: queremos enfileirar pra disparar agora SE running. Se
 * scheduled/paused, só insere e deixa pro user.
 */
async function addAccountToActiveGlobalCampaigns(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, tenant_id, status")
    .eq("id", accountId)
    .single();
  if (!account || account.status !== "active") return;

  // Campanhas globais elegíveis do tenant
  const { data: campaigns } = await supabase
    .from("mtproto_campaigns")
    .select("id, status")
    .eq("tenant_id", account.tenant_id)
    .eq("is_global", true)
    .in("status", ["running", "scheduled", "paused"]);
  if (!campaigns || campaigns.length === 0) return;

  // Dialogs da conta em kinds elegíveis. Bloqueados (write_block da sync,
  // send_refusal de envio recusado) vêm junto: entram como 'skipped' com o
  // motivo, pra tela mostrar por quê em vez de sumirem em silêncio.
  const { data: dialogs } = await supabase
    .from("mtproto_dialogs")
    .select("id, account_id, title, username, write_block, send_refusal")
    .eq("account_id", accountId)
    .in("kind", GLOBAL_DIALOG_KINDS as unknown as string[]);
  if (!dialogs || dialogs.length === 0) return;

  for (const camp of campaigns) {
    // Insere targets; collision (mesmo dialog já no DB) é raro porque conta
    // nova => dialogs novos. Contadores da campanha seguem sozinhos (trigger
    // da migration 083).
    const rows = buildGlobalTargetRows(camp.id, dialogs as GlobalDialogRow[]);
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from("mtproto_targets").insert(batch);
      if (error) {
        console.error(`[mtproto.hot-add] insert pra campanha ${camp.id} falhou:`, error);
        return;
      }
    }
    console.log(
      `[mtproto.hot-add] ${rows.length} targets da conta ${accountId} adicionados à campanha ${camp.id} (status=${camp.status})`,
    );

    // Se a campanha está running, o runner pega no próximo refetch. Mas se
    // o runner já terminou (workers caíram e o job sumiu, ou completed
    // marcou antes do hot-add), precisamos garantir que role. Enfileira
    // só se status='running' E ninguém tá rodando agora. Simples: tenta
    // CAS de 'running' pra 'running' (no-op) e reenfileira o job. Mas o
    // worker normal vai re-entrar em handleCampaignRun, que entra em
    // run() de novo — e o setCampaignStatus("running") no início do run
    // é o mesmo do estado atual, então é seguro.
    if (camp.status === "running") {
      await enqueueMtproto({ kind: "campaign.run", campaignId: camp.id }).catch((err) =>
        console.error(`[mtproto.hot-add] enqueue campaign.run falhou:`, err),
      );
    }
  }
}

async function refreshGlobalCampaignTargets(
  campaignId: string,
  tenantId: string,
): Promise<void> {
  // Sync inline de todas as contas ativas do tenant antes da run global.
  // Garante que a campanha pegue contatos novos a cada ciclo recorrente.
  const { data: accounts } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  if (!accounts || accounts.length === 0) return;

  for (const acc of accounts) {
    try {
      await handleSyncDialogs(acc.id);
    } catch (err) {
      console.error(`[mtproto.global-refresh] sync ${acc.id} failed:`, err);
    }
  }

  // Rebuild targets: deleta os pending atuais e recria do snapshot fresco.
  // Não toca em targets já 'sent' do ciclo anterior — esses ficam pra histórico.
  const accountIds = accounts.map((a) => a.id);
  const { data: dialogs } = await supabase
    .from("mtproto_dialogs")
    .select("id, account_id, title, username, write_block, send_refusal")
    .in("account_id", accountIds)
    .in("kind", GLOBAL_DIALOG_KINDS as unknown as string[]);
  const dialogList = (dialogs ?? []) as GlobalDialogRow[];
  if (dialogList.length === 0) {
    console.warn(`[mtproto.global-refresh] campaign ${campaignId}: no dialogs found after sync`);
    return;
  }

  // Remove pendings e pulados do ciclo anterior e insere o snapshot atual.
  // Bloqueado (write_block da sync, send_refusal de envio recusado) volta
  // como 'skipped' com o motivo — é o que faz o descarte durar entre ciclos
  // sem sumir da tela. Contadores seguem sozinhos (trigger da migration 083).
  await supabase
    .from("mtproto_targets")
    .delete()
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "skipped"]);

  const rows = buildGlobalTargetRows(campaignId, dialogList);
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("mtproto_targets").insert(batch);
    if (error) {
      console.error(`[mtproto.global-refresh] insert batch failed:`, error);
      return;
    }
  }
  const skipped = rows.filter((r) => r.status === "skipped").length;
  console.log(
    `[mtproto.global-refresh] campaign ${campaignId}: ${rows.length - skipped} targets refreshed, ${skipped} pulados`,
  );
}

async function handleCampaignRun(campaignId: string): Promise<void> {
  const { data: campaign } = await supabase
    .from("mtproto_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (!campaign) return;

  // Lock: garante 1 runner por campanha. Se outro worker já tá processando,
  // retorna — o hot-add reenfileira via campaign.run quando precisar.
  // TTL stale (30min): se o lock tá velho, considera worker morto e força.
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 30 * 60 * 1000);
  if (campaign.is_processing) {
    const started = campaign.processing_started_at ? new Date(campaign.processing_started_at) : null;
    if (started && started > staleThreshold) {
      console.log(`[runner] campanha ${campaignId} já em processamento, abortando reentrada`);
      return;
    }
    console.warn(`[runner] lock stale (>30min) na campanha ${campaignId}, forçando reset`);
  }
  const { data: locked, error: lockErr } = await supabase
    .from("mtproto_campaigns")
    .update({ is_processing: true, processing_started_at: now.toISOString() })
    .eq("id", campaignId)
    .eq("is_processing", campaign.is_processing) // CAS
    .select("id")
    .maybeSingle();
  if (lockErr || !locked) {
    console.log(`[runner] CAS lock falhou na campanha ${campaignId}, outro worker pegou`);
    return;
  }

  try {
    await runCampaignInner(campaignId, campaign);
  } finally {
    await supabase
      .from("mtproto_campaigns")
      .update({ is_processing: false, processing_started_at: null })
      .eq("id", campaignId);
  }
}

async function runCampaignInner(campaignId: string, campaign: Record<string, unknown> & { tenant_id: string; is_global?: boolean; recurrence_seconds?: number | null; started_at?: string | null; message_text: string; delay_min_seconds: number; delay_max_seconds: number }): Promise<void> {
  // Refresh global: deleta pending e recria do snapshot. Só roda no
  // INÍCIO de um ciclo — se já tem targets sent, é re-entrada via
  // hot-add e não pode apagar os pending recém-inseridos.
  if (campaign.is_global) {
    const { count: alreadySent } = await supabase
      .from("mtproto_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent");
    if ((alreadySent ?? 0) === 0) {
      await refreshGlobalCampaignTargets(campaignId, campaign.tenant_id);
    } else {
      console.log(
        `[runner] campanha ${campaignId}: pulando refresh (já tem ${alreadySent} sent — re-entrada)`,
      );
    }
  }

  // Snapshot mutável de contas — sendMessage precisa do session_string atual;
  // reloadPool re-popula isso pra incluir contas conectadas depois.
  let accountsSnapshot: Array<{ id: string; phone_number: string; session_string: string | null; status: string; flood_wait_until: string | null }> = [];

  async function loadAccountsAndPool(pool: AccountPool): Promise<void> {
    const { data } = await supabase
      .from("mtproto_accounts")
      .select("id, phone_number, session_string, status, flood_wait_until")
      .eq("tenant_id", campaign.tenant_id)
      .in("status", ["active", "flood_wait"]);
    accountsSnapshot = data ?? [];
    pool.load(
      accountsSnapshot.map(
        (a): PoolAccount => ({
          id: a.id,
          phoneNumber: a.phone_number,
          sessionString: a.session_string ?? "",
          status: a.status as PoolAccount["status"],
          floodWaitUntil: a.flood_wait_until ? new Date(a.flood_wait_until) : null,
        }),
      ),
    );
  }

  const pool = new AccountPool();
  await loadAccountsAndPool(pool);

  async function fetchPendingTargets(): Promise<CampaignTargetRow[]> {
    const nowIso = new Date().toISOString();
    // Pula targets com retry_after no futuro (#47) — aguardando fim do
    // FLOOD_WAIT da conta pinned. Inclui retry_after null OU já vencido.
    const { data: targets } = await supabase
      .from("mtproto_targets")
      .select("*, mtproto_dialogs(peer_id, peer_type, peer_access_hash, is_forum, forum_topic_id)")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .or(`retry_after.is.null,retry_after.lte.${nowIso}`);
    return (targets ?? []).map((t) => {
      const row: CampaignTargetRow = {
        id: t.id,
        identifier: t.target_identifier,
        type: t.target_type,
        status: t.status,
      };
      const dialog = t.mtproto_dialogs as
        | {
            peer_id: string;
            peer_type: "user" | "chat" | "channel";
            peer_access_hash: string | null;
            is_forum: boolean | null;
            forum_topic_id: number | null;
          }
        | null;
      if (dialog) {
        row.dialog = {
          peerId: dialog.peer_id,
          peerType: dialog.peer_type,
          peerAccessHash: dialog.peer_access_hash,
          isForum: Boolean(dialog.is_forum),
          forumTopicId: dialog.forum_topic_id ?? null,
        };
      }
      if (t.dialog_id) {
        row.dialogId = t.dialog_id;
      }
      if (t.account_id) {
        row.pinnedAccountId = t.account_id;
      }
      return row;
    });
  }

  const targetRows = await fetchPendingTargets();

  const runner = new CampaignRunner(
    pool,
    {
      sendMessage: async (accountId, target, text) => {
        const acc = accountsSnapshot.find((a) => a.id === accountId);
        if (!acc) throw new Error("account missing");
        const client = await getOrCreateClient(accountId, acc.session_string ?? "");
        if (target.dialog) {
          // Peer estruturado (vindo da sincronização) — caminho rápido e seguro.
          const { peerId, peerType, peerAccessHash } = target.dialog;
          if (peerType === "channel" && peerAccessHash) {
            // Supergrupo pode ser fórum com o General fechado: no TOPIC_CLOSED
            // escolhe um tópico aberto e guarda pra próxima vez ir direto.
            // Vale pra todo channel (não só is_forum) porque a flag pode estar
            // velha entre syncs; em não-fórum listTopics falha, devolve [] e o
            // TOPIC_CLOSED original segue pro runner, que pula o alvo.
            const dialogId = target.dialogId;
            await sendWithForumFallback({
              knownTopicId: target.dialog.forumTopicId ?? null,
              send: (topMsgId) =>
                client.sendMessageToPeer(peerId, peerType, peerAccessHash, text, { topMsgId }),
              listTopics: async () => {
                try {
                  const topics = await client.listForumTopics(peerId, peerAccessHash);
                  return topics.map((t) => ({ id: t.id, closed: t.closed, hidden: t.hidden, title: t.title }));
                } catch (err) {
                  console.warn(`[mtproto] listForumTopics falhou pra ${peerId}:`, err);
                  return [];
                }
              },
              rememberTopic: async (topicId) => {
                if (!dialogId) return;
                await supabase
                  .from("mtproto_dialogs")
                  .update({ is_forum: true, forum_topic_id: topicId })
                  .eq("id", dialogId);
              },
            });
          } else {
            await client.sendMessageToPeer(peerId, peerType, peerAccessHash, text);
          }
        } else {
          // Caminho legado: lista colada com @username ou +telefone.
          await client.sendMessage(target.identifier, target.type, text);
        }
        await supabase
          .from("mtproto_accounts")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", accountId);
      },
      markTargetSent: async (targetId, accountId) => {
        await supabase
          .from("mtproto_targets")
          .update({
            status: "sent",
            account_id: accountId,
            sent_at: new Date().toISOString(),
          })
          .eq("id", targetId);
      },
      markTargetFailed: async (targetId, accountId, error) => {
        await supabase
          .from("mtproto_targets")
          .update({ status: "failed", account_id: accountId, error_message: error })
          .eq("id", targetId);
      },
      skipTarget: async (targetId, target, reason) => {
        // 1. Marca o dialog: é ele que alimenta os rebuilds da campanha global
        //    (hot-add e refresh). Sem isso o destino morto voltaria pra fila
        //    no próximo ciclo e gastaria um request por ciclo, pra sempre.
        if (target.dialogId) {
          await supabase
            .from("mtproto_dialogs")
            .update({ send_refusal: reason, send_refused_at: new Date().toISOString() })
            .eq("id", target.dialogId);
        }
        // 2. Alvo vira 'skipped' com o motivo: sai do progresso (o trigger da
        //    migration 083 o deixa fora do total) mas continua na tela, pra
        //    quem opera ver por que aquele grupo não recebe.
        await supabase
          .from("mtproto_targets")
          .update({ status: "skipped", error_message: reason })
          .eq("id", targetId);
      },
      markTargetRetryAfter: async (targetId, retryAfterIso) => {
        // Mantém pending + seta retry_after (#47) — reprocessa depois do flood.
        await supabase
          .from("mtproto_targets")
          .update({ status: "pending", retry_after: retryAfterIso })
          .eq("id", targetId);
      },
      // Contadores (sent/failed/skipped/total) não são escritos aqui: o trigger
      // da migration 083 recalcula a partir das linhas de mtproto_targets a
      // cada mudança. Era read-then-write em seis caminhos e divergia.
      getCampaignStatus: async (id) => {
        const { data } = await supabase
          .from("mtproto_campaigns")
          .select("status")
          .eq("id", id)
          .single();
        return (data?.status as string | undefined) ?? null;
      },
      setCampaignStatus: async (id, status) => {
        const patch: Record<string, unknown> = { status };
        if (status === "running" && !campaign.started_at) {
          patch.started_at = new Date().toISOString();
        }
        if (status === "completed" || status === "failed") {
          patch.completed_at = new Date().toISOString();
        }
        // Se a campanha é recorrente E completou: agenda próxima execução
        // e reseta a campanha de volta pra 'draft' (pronta pro próximo ciclo).
        if (status === "completed" && campaign.recurrence_seconds) {
          const nextRun = new Date(Date.now() + campaign.recurrence_seconds * 1000);
          patch.status = "scheduled";
          patch.last_run_at = new Date().toISOString();
          patch.next_run_at = nextRun.toISOString();
          patch.started_at = null;
          patch.completed_at = null;
          // Reseta 'sent'/'failed' recuperáveis pra 'pending' pro próximo
          // ciclo. Ficam como estão: 'skipped' (destino que não aceita) e
          // 'failed' com error_message='invalid_identifier' (colado errado
          // pelo user; nunca vai funcionar). Os contadores zeram sozinhos pelo
          // trigger da migration 083.
          //
          // ARMADILHA que travava a tela em "Enviadas 0 de N": o filtro era
          // .neq("error_message", "invalid_identifier") — em SQL, `<>` sobre
          // NULL dá NULL, então toda linha 'sent' (error_message nulo) ficava
          // FORA do reset. sent_count zerava, as linhas continuavam 'sent', o
          // refresh global via "já tem sent" e se pulava, e só as falhas eram
          // retentadas — ciclo após ciclo. Por isso o `.or` com `is.null`.
          //
          // Alvo com dialog_id MANTÉM account_id: o access_hash do peer é da
          // conta dona, então o pin é obrigatório (zerar dava PEER_ID_INVALID
          // em outra conta). Lista colada volta ao round-robin (account_id
          // null).
          const { error: e1 } = await supabase
            .from("mtproto_targets")
            .update({ status: "pending", sent_at: null, error_message: null, retry_after: null })
            .eq("campaign_id", id)
            .in("status", ["sent", "failed"])
            .not("dialog_id", "is", null)
            .or("error_message.is.null,error_message.neq.invalid_identifier");
          const { error: e2 } = await supabase
            .from("mtproto_targets")
            .update({
              status: "pending",
              account_id: null,
              sent_at: null,
              error_message: null,
              retry_after: null,
            })
            .eq("campaign_id", id)
            .in("status", ["sent", "failed"])
            .is("dialog_id", null)
            .or("error_message.is.null,error_message.neq.invalid_identifier");
          if (e1 || e2) {
            console.error(`[mtproto] campaign ${id}: reset da recorrência falhou:`, e1 ?? e2);
          }
          console.log(`[mtproto] campaign ${id} is recurrent — next run scheduled at ${nextRun.toISOString()}`);
        }
        await supabase.from("mtproto_campaigns").update(patch).eq("id", id);
      },
      refetchPending: fetchPendingTargets,
      reloadPool: () => loadAccountsAndPool(pool),
      markAccountFatal: async (accountId, error) => {
        console.warn(`[mtproto] conta ${accountId} marcada como banned (erro fatal): ${error}`);
        await supabase
          .from("mtproto_accounts")
          .update({
            status: "banned",
            last_error: error,
            session_string: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", accountId);
        // Tira do liveClients pra forçar reconnect (que vai falhar mesmo, mas
        // não fica segurando objeto vivo apontando pra sessão morta)
        const live = liveClients.get(accountId);
        if (live) {
          await live.client.disconnect().catch(() => {});
          liveClients.delete(accountId);
        }
      },
      delay: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    {
      campaignId,
      messageText: campaign.message_text,
      delayMinSeconds: campaign.delay_min_seconds,
      delayMaxSeconds: campaign.delay_max_seconds,
    },
  );

  await runner.run(targetRows);
}

let mtprotoWorkerRunning = false;
/** Diagnóstico de deploy: `/health` responde se ESTE processo tem o worker. */
export function isMtprotoWorkerRunning(): boolean {
  return mtprotoWorkerRunning;
}

export function startMtprotoWorker(): void {
  if (!config.mtprotoWorkerEnabled) {
    console.log("[mtproto] worker disabled via env");
    return;
  }
  if (!config.telegramApiId || !config.telegramApiHash) {
    console.log("[mtproto] TELEGRAM_API_ID/HASH not configured — worker not started");
    return;
  }
  mtprotoWorkerRunning = true;

  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  new Worker<MtprotoJobData>(
    "mtproto",
    async (job: Job<MtprotoJobData>) => {
      const d = job.data;
      switch (d.kind) {
        case "auth.request-code":
          return handleRequestCode(d.accountId, d.phoneNumber);
        case "auth.sign-in":
          return handleSignIn(d.accountId, d.phoneNumber, d.code);
        case "auth.submit-password":
          return handleSubmitPassword(d.accountId, d.password);
        case "campaign.run":
          return handleCampaignRun(d.campaignId);
        case "account.sync-dialogs":
          return handleSyncDialogs(d.accountId);
        case "clone.run":
          return handleCloneRun(d.cloneJobId);
        case "botclone.explore":
          return handleBotCloneExplore(d.cloneJobId);
        case "botclone.build-flow":
          return handleBotCloneBuildFlow(d.cloneJobId);
        case "postcampaign.send-one":
          return handleScheduledSend(d.messageId);
        case "campaign.ai-process":
          return handleCampaignAiProcess(d.campaignId);
      }
    },
    { connection, concurrency: 4 },
  );

  console.log("[mtproto] worker started");
}
