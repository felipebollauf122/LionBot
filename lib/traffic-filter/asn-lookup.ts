/**
 * ASN/datacenter lookup via ip-api.com (free tier). Reaproveita o padrão de
 * server/src/services/geoip.ts: timeout curto + fail-safe ({} em qualquer erro).
 * Cache em memória por IP para não repetir lookup no mesmo processo.
 */

export interface AsnResult {
  asn?: string;        // ex: "AS15169"
  isHosting?: boolean; // datacenter
  isProxy?: boolean;   // vpn/proxy
}

const cache = new Map<string, AsnResult>();

/** Extrai "AS15169" de "AS15169 Google LLC". */
export function parseAsField(asField: string): string | undefined {
  const m = asField.trim().match(/^AS\d+/i);
  return m ? m[0].toUpperCase() : undefined;
}

/** Mesma lógica de isPublicIp do geoip.ts. */
export function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.")) return false;
  if (/^10\./.test(ip)) return false;
  if (/^192\.168\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return false;
  return true;
}

export async function lookupAsn(ip: string | null | undefined): Promise<AsnResult> {
  const clean = (ip ?? "").trim();
  if (!isPublicIp(clean)) return {};
  if (cache.has(clean)) return cache.get(clean)!;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,proxy,hosting,as`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return {};
    const data = (await res.json()) as {
      status?: string; proxy?: boolean; hosting?: boolean; as?: string;
    };
    if (data.status !== "success") return {};
    const result: AsnResult = {
      asn: data.as ? parseAsField(data.as) : undefined,
      isHosting: !!data.hosting,
      isProxy: !!data.proxy,
    };
    cache.set(clean, result);
    return result;
  } catch {
    return {}; // timeout, rate-limit, rede — best-effort
  }
}
