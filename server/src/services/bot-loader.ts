import { supabase } from "../db.js";
import { botCache } from "../cache.js";

interface BotPaymentShape {
  sigilopay_public_key: string | null;
  sigilopay_secret_key: string | null;
  payment_gateway?: string | null;
}

/**
 * Guarantees the cached bot has Poseidon Pay keys. If the cached object has
 * empty/null keys (stale cache from before the user configured credentials,
 * or a missed invalidation call), re-reads from the DB and refreshes the cache.
 *
 * Returns the same type back — if DB reload fails, returns the original bot.
 *
 * PERF: essa função roda em TODA mensagem/callback (webhook/telegram.ts) e nos
 * 3 workers do BullMQ. Só faz sentido recarregar quando o bot realmente usa
 * a Poseidon/SigiloPay — bot em evpay/zuckpay nunca tem sigilopay_* preenchido,
 * então o check antigo dava falso-negativo eterno e refazia um `select *` em
 * bots a cada update, anulando por completo o botCache (TTL de 10 min).
 */
const RELOAD_COOLDOWN_MS = 60_000;
const lastReloadAt = new Map<string, number>();

export async function ensureBotPaymentKeys<T extends BotPaymentShape>(
  botId: string,
  bot: T,
): Promise<T> {
  // Gateway explicitamente outro → chaves da Poseidon são irrelevantes.
  // (getGatewayKind trata qualquer valor != evpay/zuckpay como sigilopay.)
  if (bot.payment_gateway === "evpay" || bot.payment_gateway === "zuckpay") return bot;

  const hasPub = Boolean(bot.sigilopay_public_key && bot.sigilopay_public_key.trim());
  const hasSec = Boolean(bot.sigilopay_secret_key && bot.sigilopay_secret_key.trim());
  if (hasPub && hasSec) return bot;

  // Bot em sigilopay que ainda NÃO configurou as chaves cairia aqui em toda
  // mensagem. O reload só serve pra cobrir invalidação perdida, então basta
  // uma tentativa por minuto — sem isso, um bot sem pagamento configurado
  // paga um round-trip de DB por update recebido.
  const last = lastReloadAt.get(botId) ?? 0;
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return bot;

  console.warn(
    `[bot-loader] Cached bot ${botId} missing Poseidon keys (pub=${hasPub}, sec=${hasSec}) — reloading from DB`,
  );

  const { data, error } = await supabase
    .from("bots")
    .select("*")
    .eq("id", botId)
    .single();

  if (error || !data) {
    // NÃO marca o cooldown aqui: uma falha transiente (rede/PostgREST) não
    // pode prender o bot a credenciais vazias por 1 min inteiro — seria PIX
    // falhando com "chaves não configuradas" durante todo esse tempo.
    console.error(`[bot-loader] Failed to reload bot ${botId}:`, error?.message);
    return bot;
  }

  // Só conta o cooldown quando a leitura deu certo.
  lastReloadAt.set(botId, Date.now());
  botCache.set(botId, data);
  console.log(
    `[bot-loader] Bot ${botId} reloaded. pub=${data.sigilopay_public_key ? "SET" : "EMPTY"}, sec=${data.sigilopay_secret_key ? "SET" : "EMPTY"}`,
  );
  return data as T;
}
