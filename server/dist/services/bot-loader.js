import { supabase } from "../db.js";
import { botCache } from "../cache.js";
/**
 * Guarantees the cached bot has Poseidon Pay keys. If the cached object has
 * empty/null keys (stale cache from before the user configured credentials,
 * or a missed invalidation call), re-reads from the DB and refreshes the cache.
 *
 * Returns the same type back — if DB reload fails, returns the original bot.
 */
export async function ensureBotPaymentKeys(botId, bot) {
    const hasPub = Boolean(bot.sigilopay_public_key && bot.sigilopay_public_key.trim());
    const hasSec = Boolean(bot.sigilopay_secret_key && bot.sigilopay_secret_key.trim());
    if (hasPub && hasSec)
        return bot;
    console.warn(`[bot-loader] Cached bot ${botId} missing Poseidon keys (pub=${hasPub}, sec=${hasSec}) — reloading from DB`);
    const { data, error } = await supabase
        .from("bots")
        .select("*")
        .eq("id", botId)
        .single();
    if (error || !data) {
        console.error(`[bot-loader] Failed to reload bot ${botId}:`, error?.message);
        return bot;
    }
    botCache.set(botId, data);
    console.log(`[bot-loader] Bot ${botId} reloaded. pub=${data.sigilopay_public_key ? "SET" : "EMPTY"}, sec=${data.sigilopay_secret_key ? "SET" : "EMPTY"}`);
    return data;
}
