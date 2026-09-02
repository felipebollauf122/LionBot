import { createHmac, timingSafeEqual } from "node:crypto";

export type InitDataResult =
  | { ok: true; telegramUserId: number | null; authDate: Date }
  | { ok: false; reason: "missing_hash" | "bad_hash" | "expired" | "malformed" };

const DEFAULT_MAX_AGE_SECONDS = 86400;

/**
 * Verifica o initData que o Telegram entrega ao Mini App.
 *
 * Algoritmo da Bot API: a chave secreta é o HMAC-SHA256 do token do bot usando
 * a string "WebAppData" como chave; a assinatura é o HMAC dessa chave sobre os
 * pares "k=v" ordenados por chave e unidos por \n, com o próprio `hash` de fora.
 *
 * Sem isso, a URL do Mini App é só uma página pública que qualquer um abre.
 *
 * Nunca lança: falha prevista volta como dado, porque erro lançado em Server
 * Action/route vira mensagem genérica em produção.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: Date } = {},
): InitDataResult {
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");

  // Comparação em tempo constante: o hash é um segredo verificável, e comparar
  // com === vaza o prefixo correto por tempo de resposta.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDateRaw = params.get("auth_date");
  const authSeconds = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authSeconds)) {
    return { ok: false, reason: "malformed" };
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - authSeconds;
  if (ageSeconds > maxAge) return { ok: false, reason: "expired" };

  return {
    ok: true,
    telegramUserId: parseUserId(params.get("user")),
    authDate: new Date(authSeconds * 1000),
  };
}

/** O campo `user` é JSON. Vir quebrado não invalida a assinatura. */
function parseUserId(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
