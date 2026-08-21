import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrafficFilterRule } from "@/lib/types/database";
import { evaluateRules, type TrafficSignals, type TrafficCategories } from "@/lib/traffic-filter/match";
import { lookupAsn } from "@/lib/traffic-filter/asn-lookup";

export interface DecideTrafficInput {
  supabase: SupabaseClient;
  tenantId: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  fbclid: string | null;
  /** click id do TikTok Ads — clique pago do TikTok chega só com ele */
  ttclid: string | null;
  /** categorias liga/desliga do bot; se omitido, usa o default (tudo ligado) */
  categories?: TrafficCategories;
}

/**
 * Veredito de tráfego para a /t. Fail-open ABSOLUTO: qualquer erro de I/O
 * (Supabase fora, ip-api timeout) retorna "allow" — nunca derruba clique pago.
 */
export async function decideTraffic(input: DecideTrafficInput): Promise<"allow" | "block"> {
  try {
    const { data: rules } = await input.supabase
      .from("traffic_filter_rules")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true);

    const asn = await lookupAsn(input.ip);

    const signals: TrafficSignals = {
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
      fbclid: input.fbclid,
      ttclid: input.ttclid,
      asn: asn.asn ?? null,
      isHosting: !!asn.isHosting || !!asn.isProxy,
    };

    return evaluateRules(signals, (rules ?? []) as TrafficFilterRule[], input.categories);
  } catch {
    return "allow"; // fail-open: filtro nunca derruba clique legítimo
  }
}
