/**
 * Monta o link de tracking (redirect) de um bot.
 *
 * - COM Utmify configurada: link com todos os parâmetros UTM no padrão da Meta
 *   (campos {{campaign.name}} etc. são preenchidos pelo Facebook na hora do clique).
 * - SEM Utmify: link limpo, só o bot.
 *
 * `origin` é o domínio público (ex: https://lionbot.site). No cliente,
 * passe window.location.origin.
 */
/**
 * Monta SÓ a query string de tracking (sem domínio nem `/t?`), pra colar no
 * campo de parâmetros do anúncio. Ex: `bot=...&utm_source=FB&...&s=<slug>`.
 *
 * - `bot=<id>` sempre.
 * - UTMs da Meta se `hasUtmify`.
 * - `s=<slug>` se houver slug (a chave de segurança final).
 */
export function buildTrackingParams(botId: string, hasUtmify: boolean, slug?: string | null): string {
  let params = `bot=${botId}`;
  if (hasUtmify) {
    params +=
      "&utm_source=FB" +
      "&utm_campaign={{campaign.name}}|{{campaign.id}}" +
      "&utm_medium={{adset.name}}|{{adset.id}}" +
      "&utm_content={{ad.name}}|{{ad.id}}" +
      "&utm_term={{placement}}";
  }
  if (slug) params += `&s=${encodeURIComponent(slug)}`;
  return params;
}

export function buildTrackingLink(
  botId: string,
  hasUtmify: boolean,
  origin: string,
  slug?: string | null,
): string {
  return `${origin.replace(/\/+$/, "")}/t?${buildTrackingParams(botId, hasUtmify, slug)}`;
}
