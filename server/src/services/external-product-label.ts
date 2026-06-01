/**
 * Rotula um produto para envio EXTERNO (gateway PIX, Facebook CAPI,
 * Utmify, qualquer coisa que sai do nosso sistema).
 *
 * REGRA ABSOLUTA: nunca, em hipótese alguma, expõe `product.name` real
 * pra fora. Telegram do cliente é o ÚNICO lugar que pode ver o nome real.
 *
 *   - Se ghost_name preenchido → usa ghost_name
 *   - Senão → "Product N" onde N é determinístico por product.id
 *     (mesmo produto sempre vira o mesmo "Product N" entre chamadas)
 *
 * Como N é gerado: pegamos o último char hex do uuid e mapeamos pra
 * 1-16. Não preserva ordem alfabética (que vazaria info), mas é estável.
 * Pra produtos novos sem id (raro), cai pra "Product".
 */
export function productLabelForExternal(product: {
  id?: string | null;
  ghost_name?: string | null;
}): string {
  if (product.ghost_name && product.ghost_name.trim()) {
    return product.ghost_name.trim();
  }
  const id = product.id;
  if (!id) return "Product";
  // último char hex do uuid (descarta hífens) -> número 0-15 -> +1
  const cleaned = id.replace(/-/g, "");
  const lastHex = cleaned[cleaned.length - 1];
  const n = parseInt(lastHex, 16);
  if (Number.isNaN(n)) return "Product";
  return `Product ${n + 1}`;
}

/**
 * Descrição external. Mesma regra: ghost_description ou string vazia
 * (a maioria dos endpoints externos aceita vazio melhor que nome real).
 */
export function productDescriptionForExternal(product: {
  ghost_description?: string | null;
}): string | undefined {
  const d = product.ghost_description?.trim();
  return d || undefined;
}
