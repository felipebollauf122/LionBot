import { createHash } from "node:crypto";
import { createReplacement, restoreProfile } from "./protocol.js";
import { AccountBotLimit, RecoveryAttention, RetryRecovery, type BotFatherPort, type Identity, type RecoveryRun } from "./types.js";

export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export interface HealingBot {
  id: string;
  tenant_id: string;
  telegram_token: string;
  bot_username: string;
  is_active: boolean;
  webhook_url: string;
}
export interface HealingAccount { id: string; session_string: string }
export interface RecoveryDeps {
  loadBot(): Promise<HealingBot | null>;
  enabled(): Promise<boolean>;
  identity(): Promise<Identity | null>;
  save(patch: Partial<RecoveryRun>): Promise<void>;
  credentialWorks(token: string): Promise<boolean>;
  accounts(): Promise<HealingAccount[]>;
  withAccount<T>(account: HealingAccount, fn: (father: BotFatherPort) => Promise<T>): Promise<T>;
  suggest(old: string, attempts: string[]): Promise<string>;
  photo(path: string): Promise<Buffer>;
  verifyToken(token: string, username: string): Promise<void>;
  registerWebhook(token: string): Promise<void>;
  commit(): Promise<boolean>;
  invalidate(): Promise<void>;
}

export function botStillMatches(bot: HealingBot | null, run: RecoveryRun): bot is HealingBot {
  return !!bot && bot.is_active && bot.tenant_id === run.tenant_id && tokenHash(bot.telegram_token) === run.token_hash;
}

/** Orchestration independent of DB/Redis/Telegram so crash and concurrency cases can be tested. */
export async function recoverBot(run: RecoveryRun, deps: RecoveryDeps): Promise<void> {
  if (["completed", "cancelled", "needs_attention"].includes(run.status)) return;
  const save = async (patch: Partial<RecoveryRun>) => { await deps.save(patch); Object.assign(run, patch); };
  const assertCurrent = async () => {
    const bot = await deps.loadBot();
    if (!botStillMatches(bot, run) || !await deps.enabled()) {
      await save({ status: "cancelled", error_code: "bot_changed" });
      throw new RecoveryAttention("bot_changed");
    }
    return bot;
  };
  const bot = await assertCurrent();
  if (!run.new_token && !run.pending_username && await deps.credentialWorks(bot.telegram_token)) {
    await save({ status: "cancelled", error_code: "credential_recovered" });
    return;
  }
  const identity = await deps.identity();
  if (!identity) throw new RecoveryAttention("identity_backup_missing");
  const photo = identity.photoPath ? await deps.photo(identity.photoPath) : null;
  const accounts = await deps.accounts();
  const mustKeepAccount = !!(run.new_token || run.pending_username);
  const candidates = mustKeepAccount
    ? accounts.filter(a => a.id === run.account_id)
    : [...accounts].sort((a, b) => Number(b.id === run.account_id) - Number(a.id === run.account_id));
  if (!candidates.length) throw new RecoveryAttention("mtproto_account_unavailable");
  let quotaFailures = 0;
  for (const account of candidates) {
    try {
      await deps.withAccount(account, async father => {
        await assertCurrent();
        await save({ account_id: account.id });
        await createReplacement({ run, identity, father, save, suggest: deps.suggest });
        if (!run.new_token || !run.new_username) throw new RecoveryAttention("replacement_token_missing");
        await deps.verifyToken(run.new_token, run.new_username);
        await assertCurrent();
        await restoreProfile(father, identity, run.new_username, photo);
        await assertCurrent();
        await deps.registerWebhook(run.new_token);
        if (!await deps.commit()) throw new RecoveryAttention("bot_changed");
        run.status = "completed";
        run.new_token = null;
        await deps.invalidate();
      });
      return;
    } catch (error) {
      if (error instanceof AccountBotLimit && !run.new_token && !run.pending_username) {
        quotaFailures++;
        await save({ account_id: null });
        continue;
      }
      throw error;
    }
  }
  if (quotaFailures) throw new RecoveryAttention("all_accounts_bot_limit");
  throw new RetryRecovery(60);
}
