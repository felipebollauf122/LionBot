import { timingSafeEqual } from "node:crypto";

/**
 * Autorização de chamadas internas Next → worker por segredo compartilhado
 * (header `x-internal-secret` contra `config.internalApiSecret`).
 *
 * Extraída da rota pra ser testável sem precisar montar o Express inteiro
 * (que sobe workers/filas reais na importação) — achado de segurança: sem
 * isto, `/api/mtproto/ensure-bot-access` aceitava qualquer chamador,
 * bastando conhecer um `campaignId` de outro tenant. Hoje também protege
 * `/api/ai/assist` (Plano 3, Task 4).
 *
 * Secret NÃO configurado (`""`) NUNCA autoriza — "endpoint sem segredo
 * configurado" é um estado de "não pronto pra uso", não "endpoint aberto
 * pra todo mundo". `envOptional` em config.ts existe pra não travar o boot
 * do worker, não pra abrir a porta.
 *
 * Comparação timing-safe: este segredo é comparado em TODA chamada a dois
 * endpoints internos, e `===` sobre string vaza timing proporcional a
 * quantos caracteres batem antes do primeiro diferente — um atacante com
 * acesso à rede consegue, em teoria, adivinhar o segredo caractere a
 * caractere medindo a resposta. `timingSafeEqual` exige buffers do MESMO
 * tamanho (lança se não forem), então o comprimento é conferido antes —
 * comparar comprimento não é o vazamento que importa aqui (é público que o
 * segredo tem N caracteres; o que não pode vazar é QUAIS).
 */
export function isAuthorizedInternalRequest(
  configuredSecret: string,
  providedSecret: string | string[] | undefined,
): boolean {
  if (!configuredSecret) return false;
  if (typeof providedSecret !== "string") return false;

  const esperado = Buffer.from(configuredSecret);
  const recebido = Buffer.from(providedSecret);
  if (esperado.length !== recebido.length) return false;

  return timingSafeEqual(esperado, recebido);
}
