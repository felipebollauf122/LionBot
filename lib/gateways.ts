/**
 * Fonte ÚNICA de verdade dos gateways de pagamento no frontend: id, rótulo
 * exibido e quais credenciais cada um exige.
 *
 * Antes o rótulo era hardcoded em cada tela, e o mesmo gateway aparecia com
 * nomes diferentes dependendo de onde (o "evpay" era "EvPay" nas Configurações
 * e "Yvepay" no comprovante). Toda tela que mostra ou escolhe gateway deve
 * importar daqui — inclusive o editor de fluxo, onde o nó de pagamento escolhe
 * qual usar.
 *
 * Espelha o GatewayKind do servidor (server/src/services/gateway-factory.ts).
 */
export type GatewayKind = "sigilopay" | "evpay" | "zuckpay" | "nowpayments";

export interface GatewayMeta {
  kind: GatewayKind;
  label: string;
  /** Como o lead paga — usado pra rotular o método nas telas de venda. */
  method: "pix" | "crypto";
  /**
   * Campos de credencial obrigatórios (colunas de `bots`). Um gateway ativo
   * sem TODOS eles preenchidos é rejeitado ao salvar — ativo sem credencial
   * só produziria erro cru do gateway na frente do lead.
   */
  requiredFields: string[];
}

export const GATEWAYS: GatewayMeta[] = [
  {
    kind: "sigilopay",
    label: "Poseidon Pay",
    method: "pix",
    requiredFields: ["sigilopay_public_key", "sigilopay_secret_key"],
  },
  {
    kind: "evpay",
    label: "EvPay",
    method: "pix",
    requiredFields: ["evpay_api_key", "evpay_project_id"],
  },
  {
    kind: "zuckpay",
    label: "ZuckPay",
    method: "pix",
    requiredFields: ["zuckpay_client_id", "zuckpay_client_secret"],
  },
  {
    kind: "nowpayments",
    label: "Cripto (NOWPayments)",
    method: "crypto",
    requiredFields: ["nowpayments_api_key", "nowpayments_ipn_secret_key"],
  },
];

export function gatewayMeta(kind: string): GatewayMeta | undefined {
  return GATEWAYS.find((g) => g.kind === kind);
}

/** Rótulo exibível. Valor desconhecido volta como veio (nunca some da tela). */
export function gatewayLabel(kind: string): string {
  return gatewayMeta(kind)?.label ?? kind;
}

/** "PIX" ou "Criptomoeda" — método de pagamento pro lead. */
export function gatewayMethodLabel(kind: string): string {
  return gatewayMeta(kind)?.method === "crypto" ? "Criptomoeda" : "PIX";
}

/** Moedas oferecidas no seletor da NOWPayments. */
export const NOWPAYMENTS_CURRENCIES: { value: string; label: string }[] = [
  { value: "usdttrc20", label: "USDT (rede TRC20 — Tron)" },
  { value: "usdtbep20", label: "USDT (rede BEP20 — BNB Chain)" },
  { value: "trx", label: "TRX (Tron)" },
  { value: "btc", label: "BTC (Bitcoin)" },
  { value: "eth", label: "ETH (Ethereum)" },
  { value: "ltc", label: "LTC (Litecoin)" },
];
