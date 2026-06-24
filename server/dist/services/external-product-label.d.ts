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
export declare function productLabelForExternal(product: {
    id?: string | null;
    ghost_name?: string | null;
}): string;
/**
 * Descrição external. Mesma regra: ghost_description ou string vazia
 * (a maioria dos endpoints externos aceita vazio melhor que nome real).
 */
export declare function productDescriptionForExternal(product: {
    ghost_description?: string | null;
}): string | undefined;
