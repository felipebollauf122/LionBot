/**
 * In-memory TTL cache for hot-path data (bots, flows, blacklist).
 * Eliminates repeated DB queries on every webhook.
 *
 * Onda 3:
 *  #29 TTLs maiores (bot/flow mudam pouco; invalidação ativa cobre edição)
 *  #30 limite de tamanho com evicção LRU + cleanup periódico (anti-OOM)
 *  #31 cache de blacklist como Set por bot
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  lastAccess: number;
}

const DEFAULT_MAX_ENTRIES = 5000;

export class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlSeconds: number, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    entry.lastAccess = Date.now();
    return entry.data;
  }

  set(key: string, data: T): void {
    // Evicção LRU se atingir o limite (#30): remove o de acesso mais antigo.
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;
      for (const [k, e] of this.store) {
        if (e.lastAccess < oldestAccess) {
          oldestAccess = e.lastAccess;
          oldestKey = k;
        }
      }
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
      lastAccess: Date.now(),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove entradas expiradas. Chamado por sweep periódico. */
  cleanup(): void {
    const now = Date.now();
    for (const [k, e] of this.store) {
      if (now > e.expiresAt) this.store.delete(k);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

// === Singleton caches ===

// Bot config: muda raramente, 10 min TTL (invalidação ativa cobre edição)
export const botCache = new MemoryCache<Record<string, unknown>>(600);

// Active flows per bot: 5 min TTL
export const flowCache = new MemoryCache<Record<string, unknown>[]>(300);

// Single flow by ID: 5 min TTL
export const flowByIdCache = new MemoryCache<Record<string, unknown>>(300);

// Single REMARKETING flow by ID: 5 min TTL. Cache separada de flowByIdCache
// de propósito — remarketing_flows é uma tabela diferente de flows (ids não
// se cruzam na prática, mas o shape gravado é diferente: aqui é o objeto
// já adaptado pro formato `Flow` sintético que FlowProcessor consome, ver
// getRemarketingFlowById). Usada pelo fallback de roteamento de callback
// de remarketing em handleCallbackQuery.
export const remarketingFlowByIdCache = new MemoryCache<Record<string, unknown>>(300);

// Blacklist Set por bot (#31): chave = bot_id, valor = Set<telegram_user_id>.
// 5 min TTL — blacklist muda por ação manual do admin, tolerável.
export const blacklistCache = new MemoryCache<Set<number>>(300, 2000);

// Sweep periódico de entradas expiradas (#30) — evita acúmulo de chaves
// mortas que nunca mais são lidas.
const ALL_CACHES = [botCache, flowCache, flowByIdCache, remarketingFlowByIdCache, blacklistCache];
setInterval(() => {
  for (const c of ALL_CACHES) c.cleanup();
}, 5 * 60 * 1000).unref?.();
