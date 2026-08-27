export interface CreatePixPaymentParams {
  identifier: string;
  amount: number; // BRL reais
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientDocument: string;
  products?: Array<{
    id: string;
    name: string;
    description?: string;
    quantity: number;
    price: number;
  }>;
  callbackUrl: string;
  metadata?: Record<string, string>;
}

export interface PixPaymentResult {
  transactionId: string;
  status: string;
  pixCode: string;
  pixImage: string | null;
  orderId: string;
  // Só preenchidos por gateways de criptomoeda (ex: NOWPayments) — o valor
  // exato a enviar na moeda cripto escolhida, e a rede (quando relevante,
  // ex: USDT tem várias redes). Gateways PIX deixam undefined.
  payAmount?: string;
  payCurrency?: string;
  network?: string;
  // Aproximação em dólar do valor da cobrança — a mensagem de cripto (en-US)
  // mostra só isso, sem BRL. undefined se a estimativa falhou (fallback pro
  // BRL nesse caso raro, ver payment-button.ts).
  usdApprox?: string;
}

export interface PaymentGateway {
  isConfigured(): boolean;
  createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult>;
}
