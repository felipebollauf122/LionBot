"use server";

/**
 * Invalidate the bot engine's in-memory cache when bot settings or flows change.
 * Nunca lança: a maioria dos callers tolera perder a invalidação (o TTL
 * expira sozinho). Retorna `false` quando a invalidação NÃO chegou ao
 * servidor — quem depende dela de verdade (ver toggleBlackEnabled) deve
 * checar o retorno em vez de assumir sucesso.
 */
export async function invalidateBotCache(botId: string): Promise<boolean> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  try {
    const res = await fetch(`${serverUrl}/api/bots/${botId}/invalidate-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Sem timeout, um servidor pendurado travaria a server action inteira.
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
