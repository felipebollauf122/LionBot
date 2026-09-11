import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "../../config.js";
import { supabase } from "../../db.js";
import { botCache, MemoryCache } from "../../cache.js";
import { TelegramApi } from "../../telegram/api.js";
import { isBotCredentialFailure, observeBotCredentialFailures, TelegramApiError } from "../../telegram/health.js";
import { GeminiClient } from "../ai/gemini.js";
import { MtprotoClient } from "../mtproto/client.js";
import { extractWaitSeconds } from "../mtproto/flood.js";
import { sendPushToTenant } from "../push.js";
import { tenantHasHealing } from "./access.js";
import { BotFatherConversation } from "./botfather.js";
import { backupIdentity, readIdentityPhoto, type TelegramSelf } from "./identity.js";
import { withHealingLease } from "./lease.js";
import { botStillMatches, recoverBot, tokenHash, type HealingBot } from "./recovery.js";
import { RecoveryAttention, RetryRecovery, type Identity, type RecoveryRun } from "./types.js";

type HealingJob = { kind: "scan" } | { kind: "inspect"; botId: string } | { kind: "recover"; runId: string };
export interface HealingSettings {
  bot_id: string;
  enabled: boolean;
  account_ids: string[];
  identity: Identity | null;
  identity_token_hash: string | null;
  backed_up_at: string | null;
}
const BOT_FIELDS = "id,tenant_id,telegram_token,bot_username,is_active,webhook_url";
const INVALIDATION_CHANNEL = "bot-healing-invalidate";
let connection: IORedis | undefined;
let subscriber: IORedis | undefined;
let queue: Queue<HealingJob> | undefined;
let worker: Worker<HealingJob> | undefined;
const scheduled = new MemoryCache<boolean>(60, 5000);

/**
 * Para o /health responder de fora "a recuperacao de bots ligou nesta VPS?".
 * Reflete o PROCESSO, nao a intencao do env: com BOT_AUTO_HEAL_ENABLED=false o
 * worker nao sobe e isto devolve false, que e a resposta util — dizer true
 * mandaria procurar defeito onde so falta a variavel.
 */
export function isBotHealingRunning(): boolean {
  return worker !== undefined;
}

export async function loadHealingBot(botId: string): Promise<HealingBot | null> {
  const { data, error } = await supabase.from("bots").select(BOT_FIELDS).eq("id", botId).maybeSingle();
  if (error) throw new Error("bot_read_failed");
  return data;
}

export async function loadHealingSettings(botId: string): Promise<HealingSettings> {
  const inserted = await supabase.from("bot_recovery_settings").upsert({ bot_id: botId }, { onConflict: "bot_id", ignoreDuplicates: true });
  if (inserted.error) throw new Error("healing_settings_write_failed");
  const { data, error } = await supabase.from("bot_recovery_settings").select("*").eq("bot_id", botId).single();
  if (error || !data) throw new Error("healing_settings_read_failed");
  return data;
}

export async function scheduleHealingCheck(botId: string): Promise<void> {
  if (!queue) return;
  await queue.add("inspect", { kind: "inspect", botId }, { jobId: `inspect-${botId}`, removeOnComplete: true, removeOnFail: true, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
}

async function scheduleRun(runId: string): Promise<void> {
  await queue!.add("BotDeleted", { kind: "recover", runId }, { jobId: `recover-${runId}`, removeOnComplete: true, removeOnFail: true, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
}

async function credentialWorks(token: string): Promise<boolean> {
  try { await new TelegramApi(token).call("getMe"); return true; }
  catch (error) {
    if (error instanceof TelegramApiError && isBotCredentialFailure(error.error_code, error.message)) return false;
    throw error;
  }
}

async function inspectBot(botId: string): Promise<void> {
  await withHealingLease(connection!, `bot-healing-bot-${botId}`, async assertOwned => {
    const bot = await loadHealingBot(botId);
    if (!bot?.is_active) return;
    const settings = await loadHealingSettings(botId);
    if (!settings.enabled) return;
    // Depois do opt-in, para só pagar a leitura de plano por bot que pediu a
    // feature. Sem premium não abre run nem faz backup de identidade: quem saiu
    // do plano perde a recuperação inteira, não só as telas.
    if (!await tenantHasHealing(bot.tenant_id)) return;
    const api = new TelegramApi(bot.telegram_token);
    let me: TelegramSelf;
    try { me = await api.call<TelegramSelf>("getMe"); }
    catch (error) {
      if (!(error instanceof TelegramApiError) || !isBotCredentialFailure(error.error_code, error.message)) throw error;
      await assertOwned();
      // Duplicate detections collapse into one durable run per credential generation.
      const inserted = await supabase.from("bot_recovery_runs").upsert({ bot_id: bot.id, tenant_id: bot.tenant_id, token_hash: tokenHash(bot.telegram_token) }, { onConflict: "bot_id,token_hash", ignoreDuplicates: true });
      if (inserted.error) throw new Error("recovery_event_write_failed");
      const { data: run, error: readError } = await supabase.from("bot_recovery_runs").select("id,status,retry_at").eq("bot_id", bot.id).eq("token_hash", tokenHash(bot.telegram_token)).single();
      if (readError) throw new Error("recovery_event_read_failed");
      if (run && ["queued", "creating", "restoring"].includes(run.status) && (!run.retry_at || Date.parse(run.retry_at) <= Date.now())) await scheduleRun(run.id);
      return;
    }
    await assertOwned();
    // Expired cached tokens in other replicas are evicted even if pub/sub was missed.
    botCache.invalidate(bot.id);
    await connection!.publish(INVALIDATION_CHANNEL, bot.id);
    if (!settings.backed_up_at || settings.identity_token_hash !== tokenHash(bot.telegram_token) || Date.now() - Date.parse(settings.backed_up_at) > 24 * 60 * 60 * 1000) {
      await backupIdentity(bot, me);
    }
    // No incoming updates is not evidence of deletion. Probe the actual webhook.
    const webhook = await api.call<{ url: string }>("getWebhookInfo");
    const expected = `${config.baseWebhookUrl.replace(/\/$/, "")}/webhook/${bot.id}`;
    if (webhook.url !== expected) {
      const current = await loadHealingBot(bot.id);
      await assertOwned();
      if (current?.is_active && current.telegram_token === bot.telegram_token && current.tenant_id === bot.tenant_id) await api.setWebhook(expected);
    }
  });
}

async function processRun(runId: string): Promise<void> {
  const initial = await supabase.from("bot_recovery_runs").select("bot_id").eq("id", runId).maybeSingle();
  if (initial.error) throw new Error("recovery_read_failed");
  if (!initial.data) return;
  await withHealingLease(connection!, `bot-healing-bot-${initial.data.bot_id}`, async assertBotLease => {
    const { data, error } = await supabase.from("bot_recovery_runs").select("*").eq("id", runId).single();
    if (error || !data) throw new Error("recovery_read_failed");
    const run = data as RecoveryRun;
    if (!["queued", "creating", "restoring"].includes(run.status)) return;
    if (run.retry_at && Date.parse(run.retry_at) > Date.now()) return;
    const save = async (patch: Partial<RecoveryRun>) => {
      await assertBotLease();
      const result = await supabase.from("bot_recovery_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", run.id).in("status", ["queued", "creating", "restoring"]).select("id").maybeSingle();
      if (result.error || !result.data) throw new Error("recovery_checkpoint_failed");
      Object.assign(run, patch);
    };
    const assertCurrent = async () => {
      await assertBotLease();
      if (!botStillMatches(await loadHealingBot(run.bot_id), run) || !(await loadHealingSettings(run.bot_id)).enabled) throw new RecoveryAttention("bot_changed");
    };
    try {
      const settings = await loadHealingSettings(run.bot_id);
      if (!config.telegramApiId || !config.telegramApiHash || !config.geminiApiKey) throw new RecoveryAttention("healing_credentials_missing");
      const gemini = new GeminiClient(config.geminiApiKey, config.geminiModel);
      await recoverBot(run, {
        loadBot: () => loadHealingBot(run.bot_id),
        enabled: async () => (await loadHealingSettings(run.bot_id)).enabled,
        allowed: () => tenantHasHealing(run.tenant_id),
        identity: async () => settings.identity_token_hash === run.token_hash ? settings.identity : null,
        save,
        credentialWorks,
        accounts: async () => {
          const result = await supabase.from("mtproto_accounts").select("id,session_string,status,flood_wait_until").eq("tenant_id", run.tenant_id).in("status", ["active", "flood_wait"]).not("session_string", "is", null).order("last_used_at", { ascending: true, nullsFirst: true });
          if (result.error) throw new Error("mtproto_accounts_read_failed");
          const allowed = (result.data ?? []).filter(a => !settings.account_ids.length || settings.account_ids.includes(a.id));
          const eligible = allowed.filter(a => !a.flood_wait_until || Date.parse(a.flood_wait_until) <= Date.now());
          const pinned = run.account_id ? allowed.find(a => a.id === run.account_id) : undefined;
          if (pinned?.flood_wait_until && Date.parse(pinned.flood_wait_until) > Date.now()) throw new RetryRecovery(Math.ceil((Date.parse(pinned.flood_wait_until) - Date.now()) / 1000));
          if (!eligible.length && allowed.length) throw new RetryRecovery(300);
          return eligible;
        },
        withAccount: (account, fn) => withHealingLease(connection!, `bot-healing-account-${account.id}`, async assertAccountLease => {
          const assertLease = async () => {
            await assertAccountLease();
            await assertCurrent();
            const current = await supabase.from("mtproto_accounts").select("tenant_id,status,session_string").eq("id", account.id).maybeSingle();
            if (current.error) throw new Error("mtproto_account_read_failed");
            if (!current.data || current.data.tenant_id !== run.tenant_id || current.data.session_string !== account.session_string || !["active", "flood_wait"].includes(current.data.status)) throw new RecoveryAttention("mtproto_account_changed");
          };
          const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, account.session_string);
          try {
            await assertLease();
            const father = new BotFatherConversation(client, assertLease);
            await father.open();
            return await fn(father);
          } catch (error) {
            const rpcCode = (error as { errorMessage?: string })?.errorMessage ?? "";
            if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED/.test(rpcCode)) {
              const result = await supabase.from("mtproto_accounts").update({ status: /USER_DEACTIVATED/.test(rpcCode) ? "banned" : "disconnected", last_error: "auto_healing_session_unavailable" }).eq("id", account.id).eq("tenant_id", run.tenant_id);
              if (result.error) throw new Error("mtproto_status_write_failed");
              throw new RecoveryAttention("mtproto_session_unavailable");
            }
            const seconds = extractWaitSeconds(error) ?? (error instanceof RetryRecovery && error.seconds >= 300 ? error.seconds : null);
            if (seconds !== null) {
              const result = await supabase.from("mtproto_accounts").update({ status: "flood_wait", flood_wait_until: new Date(Date.now() + seconds * 1000).toISOString() }).eq("id", account.id).eq("tenant_id", run.tenant_id);
              if (result.error) throw new Error("mtproto_cooldown_write_failed");
              throw new RetryRecovery(seconds);
            }
            throw error;
          } finally { await client.disconnect().catch(() => {}); }
        }),
        suggest: (old, attempts) => gemini.generateUsername(old, attempts),
        photo: readIdentityPhoto,
        verifyToken: async (token, username) => {
          let me: TelegramSelf;
          try { me = await new TelegramApi(token).call<TelegramSelf>("getMe"); }
          catch (error) {
            if (error instanceof TelegramApiError && isBotCredentialFailure(error.error_code, error.message)) throw new RecoveryAttention("replacement_credential_invalid");
            throw error;
          }
          if (!me.is_bot || me.username?.toLowerCase() !== username.toLowerCase() || String(me.id) !== token.split(":")[0]) throw new RecoveryAttention("replacement_identity_mismatch");
        },
        registerWebhook: async token => {
          const api = new TelegramApi(token);
          const url = `${config.baseWebhookUrl.replace(/\/$/, "")}/webhook/${run.bot_id}`;
          await api.setWebhook(url);
          if ((await api.call<{ url: string }>("getWebhookInfo")).url !== url) throw new Error("replacement_webhook_unconfirmed");
        },
        commit: async () => {
          await assertBotLease();
          const result = await supabase.rpc("commit_bot_recovery", { p_run_id: run.id, p_webhook_url: `${config.baseWebhookUrl.replace(/\/$/, "")}/webhook/${run.bot_id}` });
          if (result.error) throw new Error("recovery_commit_failed");
          if (result.data !== true) run.status = "cancelled";
          return result.data === true;
        },
        invalidate: async () => {
          botCache.invalidate(run.bot_id);
          await connection!.publish(INVALIDATION_CHANNEL, run.bot_id);
        },
      });
      if (run.status === "completed") await sendPushToTenant(run.tenant_id, { title: "Bot recriado", body: `Novo endereço: @${run.new_username}. O histórico interno foi preservado.`, tag: `healing-${run.id}` });
    } catch (failure) {
      // A completed CAS must never be undone because cache invalidation/push failed.
      if (run.status === "completed" || run.status === "cancelled") return;
      if (failure instanceof RecoveryAttention) {
        await save({ status: failure.code === "bot_changed" ? "cancelled" : "needs_attention", error_code: failure.code, retry_at: null });
        console.warn(`[bot-healing] ${run.bot_id}: ${failure.code}`);
        await sendPushToTenant(run.tenant_id, { title: "Recuperação do bot precisa de atenção", body: `Código: ${failure.code}`, tag: `healing-${run.id}` });
      } else {
        const wait = failure instanceof RetryRecovery ? Math.max(1, failure.seconds) : 60;
        await save({ retry_at: new Date(Date.now() + wait * 1000).toISOString(), error_code: failure instanceof RetryRecovery ? "retry_later" : "transient_failure" });
        console.warn(`[bot-healing] ${run.bot_id}: retry scheduled in ${wait}s`);
      }
    }
  });
}

async function scan(): Promise<void> {
  // Paginate: PostgREST's default row cap must not silently skip larger fleets.
  for (let offset = 0; ; offset += 200) {
    const result = await supabase.from("bots").select("id").eq("is_active", true).order("id").range(offset, offset + 199);
    if (result.error) throw new Error("healing_scan_failed");
    for (const bot of result.data ?? []) await scheduleHealingCheck(bot.id);
    if ((result.data?.length ?? 0) < 200) break;
  }
  for (let offset = 0; ; offset += 200) {
    const result = await supabase.from("bot_recovery_runs").select("id,retry_at").in("status", ["queued", "creating", "restoring"]).order("id").range(offset, offset + 199);
    if (result.error) throw new Error("healing_resume_scan_failed");
    for (const run of result.data ?? []) if (!run.retry_at || Date.parse(run.retry_at) <= Date.now()) await scheduleRun(run.id);
    if ((result.data?.length ?? 0) < 200) break;
  }
}

export async function startBotHealing(): Promise<void> {
  if (!config.botAutoHealEnabled || worker) return;
  connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue<HealingJob>("bot-healing", { connection });
  subscriber = connection.duplicate();
  subscriber.on("message", (_channel, botId) => botCache.invalidate(botId));
  await subscriber.subscribe(INVALIDATION_CHANNEL);
  worker = new Worker<HealingJob>("bot-healing", async job => {
    if (job.data.kind === "scan") await scan();
    else if (job.data.kind === "inspect") await inspectBot(job.data.botId);
    else await processRun(job.data.runId);
  }, { connection, concurrency: 3 });
  worker.on("error", () => console.error("[bot-healing] Worker infrastructure error"));
  worker.on("failed", job => console.error(`[bot-healing] Job ${job?.id} failed; periodic scan will retry`));
  observeBotCredentialFailures(async token => {
    const hash = tokenHash(token);
    if (scheduled.get(hash)) return;
    scheduled.set(hash, true);
    // Never make a customer-facing Telegram call wait for Redis/DB availability.
    void (async () => {
      const result = await supabase.from("bots").select("id").eq("telegram_token", token).eq("is_active", true);
      if (result.error) throw new Error("bot_lookup_failed");
      for (const bot of result.data ?? []) await scheduleHealingCheck(bot.id);
    })().catch(() => { scheduled.invalidate(hash); console.error("[bot-healing] Event scheduling failed; periodic scan will retry"); });
  });
  await queue.add("scan", { kind: "scan" }, { jobId: "scan", repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: true });
  await scan();
  console.log("[bot-healing] Monitoring enabled");
}

export async function stopBotHealing(): Promise<void> {
  observeBotCredentialFailures(undefined);
  await worker?.close();
  await queue?.close();
  await subscriber?.quit();
  await connection?.quit();
  worker = undefined;
  queue = undefined;
}
