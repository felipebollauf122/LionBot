/**
 * Geo-IP via ip-api.com (free tier, ~45 req/min, sem cadastro).
 * Resolve o IP do lead em estado (regionName) + cidade.
 *
 * Usado de forma fire-and-forget no bot_start (trackLead): o IP já foi capturado
 * no page_view (event_data.client_ip), e ali não há ninguém esperando um redirect,
 * então a chamada de ~200ms não atrasa o lead.
 */
export interface GeoResult {
    state?: string;
    city?: string;
    countryCode?: string;
}
/** Resolve um IP em estado/cidade. Retorna {} em qualquer falha (nunca lança). */
export declare function geoLookup(ip: string | null | undefined): Promise<GeoResult>;
