import { describe, expect, it, vi } from "vitest";
import { createReplacement, extractBotToken, restoreProfile, validUsername, checkBotFatherReply } from "../../src/services/bot-healing/protocol.js";
import { AccountBotLimit, RecoveryAttention, RetryRecovery, type BotFatherPort, type Identity, type RecoveryRun } from "../../src/services/bot-healing/types.js";

const token = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ_123456789";
const identity: Identity = { name: "Loja Águia", username: "aguiabot", telegramId: 100, description: "Nossa loja", about: "Sobre nós", photoPath: null };
function run(): RecoveryRun {
  return { id: "run", bot_id: "bot", tenant_id: "tenant", token_hash: "hash", status: "queued", account_id: null, attempts: [], pending_username: null, pending_after_id: null, new_token: null, new_username: null, retry_at: null, error_code: null };
}
function father(replies: string[]): BotFatherPort & { sent: string[] } {
  const sent: string[] = [];
  return { sent, exchange: vi.fn(async (text, beforeSend) => { await beforeSend?.(40); sent.push(text); if (!replies.length) throw new Error("Unexpected send"); return replies.shift()!; }), repliesSince: vi.fn(async () => []), photo: vi.fn(async () => "Success! Botpic updated.") };
}
const prompts = ["Cancelled.", "Alright, a new bot. How are we going to call it? Please choose a name for your bot.", "Good. Now let's choose a username for your bot. It must end in bot."];
const success = (username: string) => `Done! Congratulations on your new bot. You will find it at t.me/${username}. Use this token to access the HTTP API:\n${token}`;

describe("BotFather protocol", () => {
  it.each(["eagle_bot", "EagleBot", "a1bot", "a".repeat(29) + "bot"])("accepts valid username %s", username => expect(validUsername(username)).toBe(true));
  it.each(["bot", "abót_bot", "@eagle_bot", "1eaglebot", "eagle", "a".repeat(30) + "bot", "eagle-bot", "eagle bot", "eaglebot\nignore"])("rejects invalid username %s", username => expect(validUsername(username)).toBe(false));

  it("persists all Gemini attempts, skips invalid/repeated suggestions and retries taken names", async () => {
    const state = run();
    const port = father([...prompts, "Sorry, this username is already taken. Please try something different.", success("aguia2bot")]);
    const suggest = vi.fn().mockResolvedValueOnce("@bad bot").mockResolvedValueOnce("AGUIABOT").mockResolvedValueOnce("aguia1bot").mockResolvedValueOnce("AGUIA1BOT").mockResolvedValueOnce("aguia2bot");
    const snapshots: Partial<RecoveryRun>[] = [];
    await createReplacement({ run: state, identity, father: port, suggest, save: async patch => { snapshots.push(structuredClone(patch)); } });
    expect(port.sent).toEqual(["/cancel", "/newbot", identity.name, "aguia1bot", "aguia2bot"]);
    expect(suggest.mock.calls[4][1]).toEqual(["aguiabot", "@bad bot", "AGUIABOT", "aguia1bot", "AGUIA1BOT"]);
    expect(snapshots).toContainEqual({ pending_username: "aguia2bot", pending_after_id: 40 });
    expect(state.new_token).toBe(token);
    expect(state.status).toBe("restoring");
  });

  it("does not send the username if the durable checkpoint fails", async () => {
    const port = father([...prompts, success("aguia2bot")]);
    await expect(createReplacement({ run: run(), identity, father: port, suggest: async () => "aguia2bot", save: async patch => { if (patch.pending_username) throw new Error("DB unavailable"); } })).rejects.toThrow("DB unavailable");
    expect(port.sent).not.toContain("aguia2bot");
  });

  it("recovers a token from BotFather history after a crash without another /newbot", async () => {
    const state = { ...run(), pending_username: "aguia2bot", pending_after_id: 40 };
    const port = father([]);
    vi.mocked(port.repliesSince).mockResolvedValue([success("aguia2bot")]);
    await createReplacement({ run: state, identity, father: port, save: async () => {}, suggest: vi.fn() });
    expect(state.new_token).toBe(token);
    expect(port.sent).toEqual([]);
    expect(port.repliesSince).toHaveBeenCalledWith(40);
  });

  it("stops an ambiguous send and refuses a token from a different bot", async () => {
    const port = father([]);
    vi.mocked(port.repliesSince).mockResolvedValue([success("differentbot")]);
    await expect(createReplacement({ run: { ...run(), pending_username: "aguia2bot", pending_after_id: 40 }, identity, father: port, save: async () => {}, suggest: vi.fn() })).rejects.toThrow("creation_outcome_unknown");
    expect(port.sent).toEqual([]);
  });

  it("resumes a definite rejection safely", async () => {
    const state = { ...run(), pending_username: "aguia1bot", pending_after_id: 40, attempts: ["aguia1bot"] };
    const port = father([...prompts, success("aguia2bot")]);
    vi.mocked(port.repliesSince).mockResolvedValue(["Sorry, this username is already taken."]);
    await createReplacement({ run: state, identity, father: port, save: async () => {}, suggest: async () => "aguia2bot" });
    expect(state.new_token).toBe(token);
  });

  it("ends a batch of repeated hallucinations with backoff and preserves the history", async () => {
    const state = run();
    const port = father([...prompts]);
    await expect(createReplacement({ run: state, identity, father: port, save: async () => {}, suggest: async () => "aguiabot" })).rejects.toBeInstanceOf(RetryRecovery);
    expect(state.attempts).toHaveLength(10);
    expect(port.sent).toEqual(["/cancel", "/newbot", identity.name]);
  });

  it("handles account quotas, restrictions and wait durations", () => {
    expect(() => checkBotFatherReply("Sorry, you have too many bots. Please delete some first.")).toThrow(AccountBotLimit);
    expect(() => checkBotFatherReply("You are not allowed to create bots.")).toThrow(RecoveryAttention);
    try { checkBotFatherReply("Too many attempts. Please try again in 2 hours."); } catch (error) { expect(error).toMatchObject({ seconds: 7200 }); }
    expect(extractBotToken(success("testbot"))).toBe(token);
    expect(extractBotToken(`Token: ${token}-`)).toBe(`${token}-`);
    expect(extractBotToken("123456:short")).toBeNull();
  });

  it("replays profile commands and uploads backed-up photo bytes", async () => {
    const port = father(["Cancelled", "Choose a bot", "Send me a photo", "Cancelled", "Choose a bot", "Send the description", "Success! Description updated", "Cancelled", "Choose a bot", "Send the about text", "Success! About updated"]);
    const bytes = Buffer.from("photo bytes");
    await restoreProfile(port, identity, "aguia2bot", bytes);
    expect(port.photo).toHaveBeenCalledWith(bytes);
    expect(port.sent).toEqual(["/cancel", "/setuserpic", "@aguia2bot", "/cancel", "/setdescription", "@aguia2bot", identity.description, "/cancel", "/setabouttext", "@aguia2bot", identity.about]);
  });
});
