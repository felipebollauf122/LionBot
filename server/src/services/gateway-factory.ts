import { SigiloPay } from "./sigilopay.js";
import { EvPay } from "./evpay.js";
import { ZuckPay } from "./zuckpay.js";
import { NowPayments } from "./nowpayments.js";
import type { PaymentGateway } from "./payment-gateway.js";

export type GatewayKind = "sigilopay" | "evpay" | "zuckpay" | "nowpayments";

export const ALL_GATEWAY_KINDS: GatewayKind[] = [
  "sigilopay",
  "evpay",
  "zuckpay",
  "nowpayments",
];

function isGatewayKind(value: unknown): value is GatewayKind {
  return typeof value === "string" && (ALL_GATEWAY_KINDS as string[]).includes(value);
}

export interface BotPaymentConfig {
  /** Gateway PADRÃO — usado quando o nó de pagamento não escolhe nenhum. */
  payment_gateway?: string | null;
  /** Todos os gateways que este bot pode usar (migration 070). */
  enabled_gateways?: string[] | null;
  sigilopay_public_key?: string | null;
  sigilopay_secret_key?: string | null;
  evpay_api_key?: string | null;
  evpay_project_id?: string | null;
  zuckpay_client_id?: string | null;
  zuckpay_client_secret?: string | null;
  nowpayments_api_key?: string | null;
  nowpayments_ipn_secret_key?: string | null;
  nowpayments_pay_currency?: string | null;
}

/** Gateway padrão do bot (o que `payment_gateway` aponta). */
export function getGatewayKind(bot: BotPaymentConfig): GatewayKind {
  return isGatewayKind(bot.payment_gateway) ? bot.payment_gateway : "sigilopay";
}

/**
 * Lista de gateways que o bot pode usar. Bots anteriores à migration 070 (ou
 * com a coluna vazia) caem no gateway padrão — nunca devolve lista vazia, pra
 * o resolvedor abaixo sempre ter pra onde cair.
 */
export function getEnabledGateways(bot: BotPaymentConfig): GatewayKind[] {
  const raw = Array.isArray(bot.enabled_gateways) ? bot.enabled_gateways : [];
  const enabled = raw.filter(isGatewayKind);
  return enabled.length > 0 ? enabled : [getGatewayKind(bot)];
}

/** Constrói um gateway específico, sem consultar qual é o padrão do bot. */
export function buildGatewayByKind(
  bot: BotPaymentConfig,
  kind: GatewayKind,
): PaymentGateway {
  if (kind === "evpay") {
    return new EvPay(bot.evpay_api_key ?? "", bot.evpay_project_id ?? "");
  }
  if (kind === "zuckpay") {
    return new ZuckPay(bot.zuckpay_client_id ?? "", bot.zuckpay_client_secret ?? "");
  }
  if (kind === "nowpayments") {
    return new NowPayments(
      bot.nowpayments_api_key ?? "",
      bot.nowpayments_ipn_secret_key ?? "",
      bot.nowpayments_pay_currency ?? "usdttrc20",
    );
  }
  return new SigiloPay(bot.sigilopay_public_key ?? "", bot.sigilopay_secret_key ?? "");
}

/**
 * Decide qual gateway REALMENTE usar dado um pedido do fluxo (nó/botão de
 * pagamento). Ponto ÚNICO dessa decisão — nada de espalhar o check por aí.
 *
 * O pedido só é honrado se o gateway estiver ativo no bot E com credenciais
 * preenchidas; senão cai no padrão. Isso cobre os casos reais de config
 * quebrada: nó apontando pra um gateway que o dono desativou depois, ou
 * ativado mas sem credencial (o `isConfigured()` de cada gateway já sabe o
 * que a sua API exige). Sem esse guard, o lead receberia um erro cru do
 * gateway ("não configurado") em vez de uma cobrança pelo caminho que
 * funciona.
 */
export function resolveGatewayKind(
  bot: BotPaymentConfig,
  requested?: string | null,
): GatewayKind {
  const fallback = getGatewayKind(bot);
  if (!isGatewayKind(requested)) return fallback;
  if (requested === fallback) return fallback;
  if (!getEnabledGateways(bot).includes(requested)) {
    console.warn(
      `[gateway] pedido "${requested}" não está ativo neste bot — usando o padrão "${fallback}"`,
    );
    return fallback;
  }
  if (!buildGatewayByKind(bot, requested).isConfigured()) {
    console.warn(
      `[gateway] pedido "${requested}" está ativo mas sem credenciais — usando o padrão "${fallback}"`,
    );
    return fallback;
  }
  return requested;
}

/** Gateway PADRÃO do bot, já instanciado. */
export function buildGateway(bot: BotPaymentConfig): {
  gateway: PaymentGateway;
  kind: GatewayKind;
} {
  const kind = getGatewayKind(bot);
  return { gateway: buildGatewayByKind(bot, kind), kind };
}
