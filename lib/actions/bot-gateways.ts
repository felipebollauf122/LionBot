import { createClient } from "@/lib/supabase/server";
import { GATEWAYS, type GatewayKind } from "@/lib/gateways";

/**
 * Gateways que o bot pode usar — alimenta os seletores de gateway do editor
 * de fluxo (nó de pagamento e botão de pagamento inline).
 *
 * Espelha o getEnabledGateways do servidor
 * (server/src/services/gateway-factory.ts): bot anterior à migration 070 (ou
 * com a coluna vazia) cai no gateway padrão, e nunca devolve lista vazia —
 * senão o editor não ofereceria nenhuma opção pra um bot perfeitamente
 * funcional.
 */
export async function getEnabledGatewaysForBot(botId: string): Promise<GatewayKind[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bots")
    .select("payment_gateway, enabled_gateways")
    .eq("id", botId)
    .single();

  const isKind = (k: unknown): k is GatewayKind =>
    typeof k === "string" && GATEWAYS.some((g) => g.kind === k);

  const stored = Array.isArray(data?.enabled_gateways)
    ? (data.enabled_gateways as unknown[]).filter(isKind)
    : [];
  if (stored.length > 0) return stored;

  return [isKind(data?.payment_gateway) ? data.payment_gateway : "sigilopay"];
}
