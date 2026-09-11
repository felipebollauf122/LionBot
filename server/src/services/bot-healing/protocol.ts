import { AccountBotLimit, RecoveryAttention, RetryRecovery, type BotFatherPort, type Identity, type RecoveryRun, type SaveRun } from "./types.js";

export function validUsername(value: string): boolean {
  return value.length >= 5 && value.length <= 32 && /^[a-z][a-z0-9_]*bot$/i.test(value);
}

export function extractBotToken(text: string): string | null {
  return text.match(/\b[0-9]{5,20}:[A-Za-z0-9_-]{30,100}(?![A-Za-z0-9_-])/)?.[0] ?? null;
}

export function checkBotFatherReply(text: string): void {
  if (/too many bots|(?:limit|maximum).{0,40}\bbots\b|(?:20|twenty) bots|can't create any more bots/i.test(text)) {
    throw new AccountBotLimit("account_bot_limit");
  }
  if (/too many attempts|try again in|flood|rate limit/i.test(text)) {
    const wait = text.match(/(?:in|after)\s+(\d+)\s*(seconds?|minutes?|hours?)/i);
    const multiplier = wait && /^h/i.test(wait[2]) ? 3600 : wait && /^m/i.test(wait[2]) ? 60 : 1;
    throw new RetryRecovery(wait ? Number(wait[1]) * multiplier : 3600);
  }
  if (/not allowed|restricted|banned|contact.*(?:support|spambot)/i.test(text)) {
    throw new RecoveryAttention("account_restricted");
  }
}

function rejected(text: string): boolean {
  return /(?:username|user name).{0,100}(?:taken|invalid|not valid|unacceptable|must|should|available)|(?:invalid|taken).{0,40}username/i.test(text);
}

function createdToken(text: string, username: string): string | null {
  const token = extractBotToken(text);
  // A historical token from another bot must never be accepted.
  const mentioned = text.match(/(?:t\.me\/|@)([A-Za-z0-9_]+)/g)?.some(link =>
    link.replace(/^t\.me\/|^@/, "").toLowerCase() === username.toLowerCase());
  return token && mentioned ? token : null;
}

/** Checkpoints bracket the only non-idempotent step: sending a username. */
export async function createReplacement(input: {
  run: RecoveryRun;
  identity: Identity;
  father: BotFatherPort;
  save: SaveRun;
  suggest: (old: string, attempts: string[]) => Promise<string>;
}): Promise<void> {
  const { run, identity, father, save, suggest } = input;
  if (run.new_token) return;
  const persist: SaveRun = async patch => { await save(patch); Object.assign(run, patch); };
  if (run.pending_username) {
    if (run.pending_after_id === null) throw new RecoveryAttention("creation_checkpoint_missing");
    const replies = await father.repliesSince(run.pending_after_id);
    const token = replies.map(text => createdToken(text, run.pending_username!)).find(Boolean);
    if (token) {
      await persist({ new_token: token, new_username: run.pending_username, status: "restoring" });
      return;
    }
    // Replaying /newbot after an uncertain send can create an orphan/duplicate.
    // Only a definite rejection makes restarting the conversation safe.
    if (!replies.some(rejected)) throw new RecoveryAttention("creation_outcome_unknown");
    await persist({ pending_username: null, pending_after_id: null });
  }
  checkBotFatherReply(await father.exchange("/cancel"));
  const namePrompt = await father.exchange("/newbot");
  checkBotFatherReply(namePrompt);
  if (!/how.*(?:call|name)|choose.*name|(?:send|give).*name/i.test(namePrompt)) throw new RecoveryAttention("botfather_name_prompt_changed");
  const usernamePrompt = await father.exchange(identity.name);
  checkBotFatherReply(usernamePrompt);
  if (!/username|user name/i.test(usernamePrompt)) throw new RecoveryAttention("botfather_username_prompt_changed");
  await persist({ status: "creating" });

  // Small batches free the account lock; attempts persist across every batch.
  for (let i = 0; i < 10; i++) {
    const candidate = (await suggest(identity.username, [identity.username, ...run.attempts])).trim();
    const duplicate = [identity.username, ...run.attempts].some(value => value.toLowerCase() === candidate.toLowerCase());
    await persist({ attempts: [...run.attempts, candidate] });
    if (duplicate || !validUsername(candidate)) continue;
    let reply: string;
    try {
      reply = await father.exchange(candidate, afterId => persist({ pending_username: candidate, pending_after_id: afterId }));
    } catch (error) {
      if (error instanceof RetryRecovery && error.notSent) await persist({ pending_username: null, pending_after_id: null });
      throw error;
    }
    const token = createdToken(reply, candidate);
    if (token) {
      await persist({ new_token: token, new_username: candidate, status: "restoring" });
      return;
    }
    if (rejected(reply)) {
      await persist({ pending_username: null, pending_after_id: null });
      continue;
    }
    // BotFather replied conclusively with no token (e.g. quota or cooldown).
    try { checkBotFatherReply(reply); } catch (error) {
      await persist({ pending_username: null, pending_after_id: null });
      throw error;
    }
    throw new RecoveryAttention("botfather_creation_reply_changed");
  }
  throw new RetryRecovery(60);
}

/** Profile commands are idempotent and can be replayed after a process restart. */
export async function restoreProfile(father: BotFatherPort, identity: Identity, username: string, photo: Buffer | null): Promise<void> {
  const setField = async (command: string, value: string | Buffer, prompt: RegExp) => {
    checkBotFatherReply(await father.exchange("/cancel"));
    const select = await father.exchange(command);
    checkBotFatherReply(select);
    if (!/choose.*bot|which bot|select.*bot|send.*username/i.test(select)) throw new RecoveryAttention("botfather_select_prompt_changed");
    const request = await father.exchange(`@${username}`);
    checkBotFatherReply(request);
    if (!prompt.test(request)) throw new RecoveryAttention("botfather_profile_prompt_changed");
    const result = typeof value === "string" ? await father.exchange(value || "/empty") : await father.photo(value);
    checkBotFatherReply(result);
    if (!/success|updated|changed|done/i.test(result)) throw new RecoveryAttention("botfather_profile_update_unconfirmed");
  };
  if (photo) await setField("/setuserpic", photo, /photo|picture/i);
  if (identity.description) await setField("/setdescription", identity.description, /description/i);
  if (identity.about) await setField("/setabouttext", identity.about, /about|description/i);
}
