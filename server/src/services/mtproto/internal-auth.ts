/**
 * Autorização de chamadas internas Next → worker por segredo compartilhado
 * (header `x-internal-secret` contra `config.internalApiSecret`).
 *
 * Extraída da rota pra ser testável sem precisar montar o Express inteiro
 * (que sobe workers/filas reais na importação) — achado de segurança: sem
 * isto, `/api/mtproto/ensure-bot-access` aceitava qualquer chamador,
 * bastando conhecer um `campaignId` de outro tenant.
 *
 * Secret NÃO configurado (`""`) NUNCA autoriza — "endpoint sem segredo
 * configurado" é um estado de "não pronto pra uso", não "endpoint aberto
 * pra todo mundo". `envOptional` em config.ts existe pra não travar o boot
 * do worker, não pra abrir a porta.
 */
export function isAuthorizedInternalRequest(
  configuredSecret: string,
  providedSecret: string | string[] | undefined,
): boolean {
  if (!configuredSecret) return false;
  return providedSecret === configuredSecret;
}
