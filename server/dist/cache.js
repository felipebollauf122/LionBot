/**
 * In-memory TTL cache for hot-path data (bots, flows, blacklist).
 * Eliminates repeated DB queries on every webhook.
 *
 * Onda 3:
 *  #29 TTLs maiores (bot/flow mudam pouco; invalidação ativa cobre edição)
 *  #30 limite de tamanho com evicção LRU + cleanup periódico (anti-OOM)
 *  #31 cache de blacklist como Set por bot
 */
const DEFAULT_MAX_ENTRIES = 5000;
export class MemoryCache {
    store = new Map();
    ttlMs;
    maxEntries;
    constructor(ttlSeconds, maxEntries = DEFAULT_MAX_ENTRIES) {
        this.ttlMs = ttlSeconds * 1000;
        this.maxEntries = maxEntries;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        entry.lastAccess = Date.now();
        return entry.data;
    }
    set(key, data) {
        // Evicção LRU se atingir o limite (#30): remove o de acesso mais antigo.
        if (!this.store.has(key) && this.store.size >= this.maxEntries) {
            let oldestKey = null;
            let oldestAccess = Infinity;
            for (const [k, e] of this.store) {
                if (e.lastAccess < oldestAccess) {
                    oldestAccess = e.lastAccess;
                    oldestKey = k;
                }
            }
            if (oldestKey)
                this.store.delete(oldestKey);
        }
        this.store.set(key, {
            data,
            expiresAt: Date.now() + this.ttlMs,
            lastAccess: Date.now(),
        });
    }
    invalidate(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
    /** Remove entradas expiradas. Chamado por sweep periódico. */
    cleanup() {
        const now = Date.now();
        for (const [k, e] of this.store) {
            if (now > e.expiresAt)
                this.store.delete(k);
        }
    }
    get size() {
        return this.store.size;
    }
}
// === Singleton caches ===
// Bot config: muda raramente, 10 min TTL (invalidação ativa cobre edição)
export const botCache = new MemoryCache(600);
// Active flows per bot: 5 min TTL
export const flowCache = new MemoryCache(300);
// Single flow by ID: 5 min TTL
export const flowByIdCache = new MemoryCache(300);
// Blacklist Set por bot (#31): chave = bot_id, valor = Set<telegram_user_id>.
// 5 min TTL — blacklist muda por ação manual do admin, tolerável.
export const blacklistCache = new MemoryCache(300, 2000);
// Sweep periódico de entradas expiradas (#30) — evita acúmulo de chaves
// mortas que nunca mais são lidas.
const ALL_CACHES = [botCache, flowCache, flowByIdCache, blacklistCache];
setInterval(() => {
    for (const c of ALL_CACHES)
        c.cleanup();
}, 5 * 60 * 1000).unref?.();
