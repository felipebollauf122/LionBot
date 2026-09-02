import type { Reaction } from "@/lib/social-proof/types";

/**
 * Normaliza a lista de reações vinda do jsonb.
 *
 * Mesma razão de normalizeMedia: o Postgres não valida jsonb contra o nosso
 * formato, e `reactions` chega por uma Server Action que qualquer sessão
 * autenticada invoca direto. Sem isto, um item cujo `emoji` seja objeto vira
 * filho JSX inválido e derruba o render da rota PÚBLICA do Mini App — e não há
 * error.tsx em lugar nenhum do app pra segurar.
 *
 * Nunca lança: item malformado é descartado.
 */
export function normalizeReactions(raw: unknown): Reaction[] {
  if (!Array.isArray(raw)) return [];

  const out: Reaction[] = [];
  for (const bruto of raw) {
    if (typeof bruto !== "object" || bruto === null) continue;
    const { emoji, count } = bruto as Record<string, unknown>;
    if (typeof emoji !== "string" || emoji === "") continue;
    if (typeof count !== "number" || !Number.isFinite(count)) continue;
    out.push({ emoji, count: Math.max(0, Math.floor(count)) });
  }
  return out;
}
