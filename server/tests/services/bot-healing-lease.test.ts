import { afterEach, describe, expect, it, vi } from "vitest";
import type IORedis from "ioredis";
import { withHealingLease } from "../../src/services/bot-healing/lease.js";
import { RetryRecovery } from "../../src/services/bot-healing/types.js";

afterEach(() => vi.useRealTimers());
function redisFixture() {
  const entries = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, owner: string) => { if (entries.has(key)) return null; entries.set(key, owner); return "OK"; }),
    get: vi.fn(async (key: string) => entries.get(key)),
    eval: vi.fn(async (script: string, _count: number, key: string, owner: string) => {
      if (entries.get(key) !== owner) return 0;
      if (script.includes("'del'")) entries.delete(key);
      return 1;
    }),
  };
  return { entries, redis: redis as unknown as IORedis };
}
describe("distributed recovery leases", () => {
  it("blocks a concurrent conversation for the same account", async () => {
    const { redis, entries } = redisFixture();
    await withHealingLease(redis, "account-1", async assertOwned => {
      await expect(withHealingLease(redis, "account-1", async () => {})).rejects.toBeInstanceOf(RetryRecovery);
      await expect(assertOwned()).resolves.toBeUndefined();
      expect(entries.has("account-1")).toBe(true);
    });
    expect(entries.has("account-1")).toBe(false);
  });
  it("fails closed after lock loss and cannot delete the new owner's lock", async () => {
    const { redis, entries } = redisFixture();
    await withHealingLease(redis, "account-1", async assertOwned => {
      entries.set("account-1", "another-worker");
      await expect(assertOwned()).rejects.toBeInstanceOf(RetryRecovery);
    });
    expect(entries.get("account-1")).toBe("another-worker");
  });
  it("renews a long-running conversation and detects failed renewal", async () => {
    vi.useFakeTimers();
    const { redis, entries } = redisFixture();
    await withHealingLease(redis, "account-1", async assertOwned => {
      await vi.advanceTimersByTimeAsync(40_000);
      expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("pexpire"), 1, "account-1", expect.any(String), 120_000);
      entries.delete("account-1");
      await vi.advanceTimersByTimeAsync(40_000);
      await expect(assertOwned()).rejects.toBeInstanceOf(RetryRecovery);
    });
  });
});
