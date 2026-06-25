/**
 * Monta o link de tracking (redirect) de um bot.
 *
 * - COM Utmify configurada: link com todos os parâmetros UTM no padrão da Meta
 *   (campos {{campaign.name}} etc. são preenchidos pelo Facebook na hora do clique).
 * - SEM Utmify: link limpo, só o bot.
 *
 * `origin` é o domínio público (ex: https://eagle-bot.vercel.app). No cliente,
 * passe window.location.origin.
 */
export function buildTrackingLink(botId: string, hasUtmify: boolean, origin: string): string {
  const base = `${origin.replace(/\/+$/, "")}/t?bot=${botId}`;
  if (!hasUtmify) return base;
  const utm =
    "utm_source=FB" +
    "&utm_campaign={{campaign.name}}|{{campaign.id}}" +
    "&utm_medium={{adset.name}}|{{adset.id}}" +
    "&utm_content={{ad.name}}|{{ad.id}}" +
    "&utm_term={{placement}}";
  return `${base}&${utm}`;
}
