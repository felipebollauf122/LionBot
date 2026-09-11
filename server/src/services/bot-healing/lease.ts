import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import { RetryRecovery } from "./types.js";

const TTL = 120_000;
const RENEW = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

/** Renewable, owner-checked locks prevent overlapping BotFather conversations across replicas. */
export async function withHealingLease<T>(redis: IORedis, key: string, fn: (assertOwned: () => Promise<void>) => Promise<T>): Promise<T> {
  const owner = randomUUID();
  if (await redis.set(key, owner, "PX", TTL, "NX") !== "OK") throw new RetryRecovery(30);
  let lost = false;
  const timer = setInterval(() => {
    void redis.eval(RENEW, 1, key, owner, TTL).then(result => { if (result !== 1) lost = true; }).catch(() => { lost = true; });
  }, TTL / 3);
  timer.unref();
  const assertOwned = async () => {
    if (lost || await redis.get(key) !== owner) throw new RetryRecovery(60);
  };
  try { return await fn(assertOwned); }
  finally {
    clearInterval(timer);
    await redis.eval(RELEASE, 1, key, owner).catch(() => {});
  }
}
