/**
 * Geo-IP via ip-api.com (free tier, ~45 req/min, sem cadastro).
 * Resolve o IP do lead em estado (regionName) + cidade.
 *
 * Usado de forma fire-and-forget no bot_start (trackLead): o IP já foi capturado
 * no page_view (event_data.client_ip), e ali não há ninguém esperando um redirect,
 * então a chamada de ~200ms não atrasa o lead.
 */
/** IPs que não vale consultar (privados/loopback/vazios). */
function isPublicIp(ip) {
    if (!ip)
        return false;
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127."))
        return false;
    if (/^10\./.test(ip))
        return false;
    if (/^192\.168\./.test(ip))
        return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip))
        return false;
    if (ip.startsWith("fc") || ip.startsWith("fd"))
        return false; // IPv6 ULA
    return true;
}
/** Resolve um IP em estado/cidade. Retorna {} em qualquer falha (nunca lança). */
export async function geoLookup(ip) {
    const clean = (ip ?? "").trim();
    if (!isPublicIp(clean))
        return {};
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,countryCode,regionName,city`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok)
            return {};
        const data = (await res.json());
        if (data.status !== "success")
            return {};
        return {
            state: data.regionName || undefined,
            city: data.city || undefined,
            countryCode: data.countryCode || undefined,
        };
    }
    catch {
        return {}; // timeout, rate-limit, rede — geo é best-effort
    }
}
