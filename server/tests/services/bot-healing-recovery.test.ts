import { describe, expect, it, vi } from "vitest";
import { recoverBot, tokenHash, type HealingBot, type RecoveryDeps } from "../../src/services/bot-healing/recovery.js";
import type { RecoveryRun } from "../../src/services/bot-healing/types.js";

const oldToken = "1000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const newToken = "2000000000:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const bot: HealingBot = { id: "bot", tenant_id: "tenant", telegram_token: oldToken, is_active: true, bot_username: "oldbot", webhook_url: "https://test/webhook/bot" };
function fixture() {
  const run: RecoveryRun = { id: "run", bot_id: bot.id, tenant_id: bot.tenant_id, token_hash: tokenHash(oldToken), status: "restoring", account_id: "account", attempts: ["newbot"], pending_username: "newbot", pending_after_id: 5, new_token: newToken, new_username: "newbot", retry_at: null, error_code: null };
  const events: string[] = [];
  const father = { exchange: vi.fn(), photo: vi.fn(), repliesSince: vi.fn() };
  const deps: RecoveryDeps = {
    loadBot: vi.fn(async () => ({ ...bot })), enabled: async () => true,
    identity: async () => ({ name: "Loja", username: "oldbot", telegramId: 100, description: "", about: "", photoPath: null }),
    save: vi.fn(async patch => { Object.assign(run, patch); }), credentialWorks: vi.fn(async () => false),
    accounts: async () => [{ id: "account", session_string: "session" }], withAccount: async (_account, fn) => fn(father),
    suggest: vi.fn(), photo: vi.fn(), verifyToken: vi.fn(async () => { events.push("verify"); }),
    registerWebhook: vi.fn(async () => { events.push("webhook"); }),
    commit: vi.fn(async () => { events.push("commit"); return true; }), invalidate: vi.fn(async () => { events.push("invalidate"); }),
  };
  return { run, deps, father, events };
}

describe("bot recovery orchestration", () => {
  it("resumes with the saved token, verifies the new bot and webhook before CAS", async () => {
    const { run, deps, father, events } = fixture();
    await recoverBot(run, deps);
    expect(events).toEqual(["verify", "webhook", "commit", "invalidate"]);
    expect(deps.credentialWorks).not.toHaveBeenCalled();
    expect(father.exchange).not.toHaveBeenCalled();
    expect(run.status).toBe("completed");
  });

  it.each(["token", "owner", "inactive"])("does not overwrite manual changes: %s", async change => {
    const { run, deps } = fixture();
    vi.mocked(deps.loadBot).mockResolvedValue({ ...bot, ...(change === "token" ? { telegram_token: newToken } : change === "owner" ? { tenant_id: "other-tenant" } : { is_active: false }) });
    await expect(recoverBot(run, deps)).rejects.toThrow("bot_changed");
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.registerWebhook).not.toHaveBeenCalled();
    expect(run.status).toBe("cancelled");
  });

  it("does not create a bot for a recovered credential", async () => {
    const { run, deps, father } = fixture();
    Object.assign(run, { status: "queued", new_token: null, pending_username: null });
    vi.mocked(deps.credentialWorks).mockResolvedValue(true);
    await recoverBot(run, deps);
    expect(run.status).toBe("cancelled");
    expect(father.exchange).not.toHaveBeenCalled();
  });

  it("requires a durable identity backup", async () => {
    const { run, deps, father } = fixture();
    deps.identity = async () => null;
    await expect(recoverBot(run, deps)).rejects.toThrow("identity_backup_missing");
    expect(father.exchange).not.toHaveBeenCalled();
  });

  it("retries a failed webhook registration using the same saved token", async () => {
    const { run, deps, father } = fixture();
    vi.mocked(deps.registerWebhook).mockRejectedValueOnce(new Error("network"));
    await expect(recoverBot(run, deps)).rejects.toThrow("network");
    expect(run.new_token).toBe(newToken);
    expect(deps.commit).not.toHaveBeenCalled();
    await recoverBot(run, deps);
    expect(deps.registerWebhook).toHaveBeenNthCalledWith(2, newToken);
    expect(father.exchange).not.toHaveBeenCalled();
  });

  it("rechecks ownership after profile restoration and before webhook registration", async () => {
    const { run, deps } = fixture();
    vi.mocked(deps.loadBot).mockResolvedValueOnce(bot).mockResolvedValueOnce(bot).mockResolvedValueOnce({ ...bot, tenant_id: "other" });
    await expect(recoverBot(run, deps)).rejects.toThrow("bot_changed");
    expect(deps.registerWebhook).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it("never marks a losing CAS as completed", async () => {
    const { run, deps } = fixture();
    vi.mocked(deps.commit).mockResolvedValue(false);
    await expect(recoverBot(run, deps)).rejects.toThrow("bot_changed");
    expect(run.status).not.toBe("completed");
    expect(deps.invalidate).not.toHaveBeenCalled();
  });

  it("rotates a previously selected full account before creation, keeping the tenant pool", async () => {
    const { run, deps } = fixture();
    Object.assign(run, { status: "queued", new_token: null, new_username: null, pending_username: null });
    deps.accounts = async () => [{ id: "account", session_string: "session1" }, { id: "account2", session_string: "session2" }];
    const used: string[] = [];
    deps.withAccount = async (account, fn) => {
      used.push(account.id);
      const replies = account.id === "account" ? ["Cancelled", "Sorry, you have too many bots."] : ["Cancelled", "How are we going to call it?", "Choose a username", `Done! t.me/newbot\n${newToken}`];
      return fn({ exchange: async (_text, beforeSend) => { await beforeSend?.(50); return replies.shift()!; }, repliesSince: async () => [], photo: vi.fn() });
    };
    deps.suggest = async () => "newbot";
    // An old attempt can be rejected; use a genuinely new name in this session.
    run.attempts = [];
    await recoverBot(run, deps);
    expect(used).toEqual(["account", "account2"]);
    expect(run.account_id).toBe("account2");
    expect(run.status).toBe("completed");
  });

  it("reports when every available account has hit its bot quota", async () => {
    const { run, deps } = fixture();
    Object.assign(run, { status: "queued", account_id: null, new_token: null, new_username: null, pending_username: null });
    deps.accounts = async () => [{ id: "account", session_string: "one" }, { id: "account2", session_string: "two" }];
    deps.withAccount = async (_account, fn) => fn({ exchange: async text => text === "/cancel" ? "Cancelled" : "You have too many bots.", repliesSince: async () => [], photo: vi.fn() });
    await expect(recoverBot(run, deps)).rejects.toThrow("all_accounts_bot_limit");
    expect(deps.commit).not.toHaveBeenCalled();
    expect(run.account_id).toBeNull();
  });

  it("never switches accounts once the replacement token exists", async () => {
    const { run, deps } = fixture();
    deps.accounts = async () => [{ id: "another-account", session_string: "other" }];
    await expect(recoverBot(run, deps)).rejects.toThrow("mtproto_account_unavailable");
    expect(deps.commit).not.toHaveBeenCalled();
    expect(run.new_token).toBe(newToken);
  });
});
