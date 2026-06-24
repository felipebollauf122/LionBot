interface BotPaymentShape {
    sigilopay_public_key: string | null;
    sigilopay_secret_key: string | null;
}
/**
 * Guarantees the cached bot has Poseidon Pay keys. If the cached object has
 * empty/null keys (stale cache from before the user configured credentials,
 * or a missed invalidation call), re-reads from the DB and refreshes the cache.
 *
 * Returns the same type back — if DB reload fails, returns the original bot.
 */
export declare function ensureBotPaymentKeys<T extends BotPaymentShape>(botId: string, bot: T): Promise<T>;
export {};
