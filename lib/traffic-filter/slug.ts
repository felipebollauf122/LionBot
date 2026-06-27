import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** SHA-256 hex de um slug. O slug é curto e aleatório, então um hash simples
 *  basta (não é senha humana reutilizável → não precisa bcrypt/salt). */
export function hashSlug(slug: string): string {
  return createHash("sha256").update(slug.trim()).digest("hex");
}

/** Gera um slug aleatório curto, charset url-safe sem caracteres ambíguos. */
export function generateSlug(len = 8): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // sem l/o/0/1 (confusos)
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Compara o slug trazido na URL com o hash guardado, em tempo constante. */
export function slugMatches(slugFromUrl: string | null, storedHash: string | null): boolean {
  if (!storedHash || !slugFromUrl) return false;
  const got = Buffer.from(hashSlug(slugFromUrl), "hex");
  const want = Buffer.from(storedHash, "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/**
 * Veredito do portão de slug. NÃO é o veredito final — só decide se o visitante
 * tem PERMISSÃO de prosseguir pro resto do filtro.
 *   - portão desligado  → "pass" (não interfere)
 *   - portão ligado + slug certo → "pass" (segue pros outros filtros)
 *   - portão ligado + slug errado/ausente → "block"
 */
export function evaluateSlugGate(
  enabled: boolean,
  storedHash: string | null,
  slugFromUrl: string | null,
): "pass" | "block" {
  if (!enabled) return "pass";
  return slugMatches(slugFromUrl, storedHash) ? "pass" : "block";
}
