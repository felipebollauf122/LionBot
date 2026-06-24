/**
 * In-memory TTL cache for hot-path data (bots, flows, blacklist).
 * Eliminates repeated DB queries on every webhook.
 *
 * Onda 3:
 *  #29 TTLs maiores (bot/flow mudam pouco; invalidação ativa cobre edição)
 *  #30 limite de tamanho com evicção LRU + cleanup periódico (anti-OOM)
 *  #31 cache de blacklist como Set por bot
 */
export declare class MemoryCache<T> {
    private store;
    private ttlMs;
    private maxEntries;
    constructor(ttlSeconds: number, maxEntries?: number);
    get(key: string): T | undefined;
    set(key: string, data: T): void;
    invalidate(key: string): void;
    clear(): void;
    /** Remove entradas expiradas. Chamado por sweep periódico. */
    cleanup(): void;
    get size(): number;
}
export declare const botCache: MemoryCache<Record<string, unknown>>;
export declare const flowCache: MemoryCache<Record<string, unknown>[]>;
export declare const flowByIdCache: MemoryCache<Record<string, unknown>>;
export declare const blacklistCache: MemoryCache<Set<number>>;
