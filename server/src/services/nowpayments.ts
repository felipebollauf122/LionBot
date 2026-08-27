import { createHmac } from "crypto";
import type {
  CreatePixPaymentParams,
  PaymentGateway,
  PixPaymentResult,
} from "./payment-gateway.js";

/**
 * NOWPayments — gateway de criptomoeda.
 * Docs: https://documenter.getpostman.com/view/7907941/S1a32n38
 *
 * Modelo:
 *  - Auth: header x-api-key em toda chamada.
 *  - IPN assinado com HMAC-SHA512 sobre o JSON com chaves ordenadas
 *    recursivamente (NÃO o buffer bruto — diferente do EvPay/ZuckPay).
 *  - NOWPayments faz a conversão BRL→cripto sozinha (price_currency=brl,
 *    pay_currency=<moeda configurada pelo bot>) — sem lógica de câmbio aqui.
 *  - Não devolve QR pronto — o fallback qrserver.com que payment-button.ts
 *    já usa pra PIX (a partir de pixCode) serve igual pro endereço cripto.
 */
export class NowPayments implements PaymentGateway {
  private baseUrl = "https://api.nowpayments.io/v1";

  constructor(
    private apiKey: string,
    private ipnSecretKey: string,
    private payCurrency: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.ipnSecretKey);
  }

  async createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "NOWPayments is not configured. Go to Bot Settings and fill in the API Key and the IPN Secret Key.",
      );
    }

    // Descrição: mesma lógica do ZuckPay (primeiro produto, name + description
    // se houver). O caller já passa name=ghost_name||name (ver payment-button.ts).
    const firstProduct = params.products?.[0];
    const description = firstProduct
      ? firstProduct.description
        ? `${firstProduct.name} — ${firstProduct.description}`
        : firstProduct.name
      : `Pedido ${params.identifier}`;

    const payload: Record<string, unknown> = {
      price_amount: params.amount,
      price_currency: "brl",
      pay_currency: this.payCurrency,
      order_id: params.identifier,
      order_description: description,
      ipn_callback_url: params.callbackUrl,
    };

    console.log(`[nowpayments] Creating payment (pay_currency=${this.payCurrency})`);
    console.log(`[nowpayments] Payload enviado:`, JSON.stringify(payload, null, 2));

    const response = await fetch(`${this.baseUrl}/payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
      // Timeout pra não pendurar a geração da cobrança (e o cliente no
      // Telegram) caso a NOWPayments esteja lenta.
      signal: AbortSignal.timeout(15_000),
    });

    const rawBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(`[nowpayments] response status=${response.status} body=${JSON.stringify(rawBody)}`);

    if (!response.ok) {
      const msg =
        (rawBody as { message?: string }).message ??
        (rawBody as { error?: string }).error ??
        response.statusText ??
        "erro desconhecido";
      console.error(`[nowpayments] createPixPayment failed (${response.status}):`, msg);

      // "Crypto amount X is less than minimal" — a NOWPayments impõe um
      // mínimo por moeda/rede (varia com congestionamento) e não temos como
      // checar antes com certeza sem depender de um endpoint cujo formato de
      // resposta não validamos ao vivo. Quando estoura, o erro cru em inglês
      // ("Crypto amount 3.860356 is less than minimal") ia direto pro chat do
      // CLIENTE — que não tem como fazer nada com essa informação. O dono do
      // bot é quem precisa agir (subir o preço do produto ou trocar a moeda
      // nas Configurações), então: log operacional bem explícito pro dono
      // encontrar, e uma mensagem genérica em português pro cliente.
      if (/less than minimal/i.test(String(msg))) {
        console.error(
          `[nowpayments] ⚠️ Preço do produto abaixo do mínimo aceito pela NOWPayments para pay_currency="${this.payCurrency}" ` +
          `(price_amount=${params.amount} BRL, produto="${description}"). Ação: aumente o preço deste produto, ou troque a ` +
          `moeda de recebimento nas Configurações do bot (USDT/TRX têm mínimo mais baixo que BTC/ETH).`,
        );
        throw new Error(
          `This crypto payment amount can't be processed right now. Please try again later or contact support.`,
        );
      }

      throw new Error(`NOWPayments error (${response.status}): ${msg}`);
    }

    const paymentId = String(rawBody.payment_id ?? "");
    const payAddress = String(rawBody.pay_address ?? "");
    const status = String(rawBody.payment_status ?? "waiting");
    const payAmount = rawBody.pay_amount != null ? String(rawBody.pay_amount) : undefined;
    const payCurrency = rawBody.pay_currency != null ? String(rawBody.pay_currency) : undefined;
    const network = rawBody.network != null ? String(rawBody.network) : undefined;
    const orderId = String(rawBody.order_id ?? params.identifier);

    if (!paymentId) {
      console.error(`[nowpayments] response missing payment_id. body:`, JSON.stringify(rawBody));
      throw new Error(`NOWPayments returned a response without a payment id. Check the API Key.`);
    }
    if (!payAddress) {
      console.error(`[nowpayments] response missing pay_address. body:`, JSON.stringify(rawBody));
      throw new Error(`NOWPayments returned a response without a payment address.`);
    }

    console.log(`[nowpayments] payment created, id ${paymentId}, address ${payAddress}`);

    return {
      transactionId: paymentId,
      status,
      pixCode: payAddress,
      pixImage: null,
      orderId,
      payAmount,
      payCurrency,
      network,
    };
  }

  /**
   * Consulta o status atual de um pagamento. Usado pelo poller pra detectar
   * confirmação quando o IPN não chega.
   * GET /payment/{payment_id} → { payment_status, ... }
   */
  async getPaymentStatus(paymentId: string): Promise<{ status: string } | null> {
    if (!this.isConfigured()) return null;
    try {
      const response = await fetch(`${this.baseUrl}/payment/${encodeURIComponent(paymentId)}`, {
        method: "GET",
        headers: { Accept: "application/json", "x-api-key": this.apiKey },
        // Timeout obrigatório: sem ele uma conexão pendurada fica presa no
        // pool do undici e envenena as próximas chamadas do poller.
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) return null;
      const body = (await response.json().catch(() => ({}))) as {
        payment_status?: string;
        message?: string;
      };
      if (!response.ok) {
        console.error(`[nowpayments] getPaymentStatus(${paymentId}) failed (${response.status}): ${body.message ?? response.statusText}`);
        return null;
      }
      const status = String(body.payment_status ?? "");
      if (!status) return null;
      return { status };
    } catch (err) {
      console.warn(`[nowpayments] getPaymentStatus(${paymentId}) erro:`, err);
      return null;
    }
  }

  /**
   * Traduz o payment_status nativo da NOWPayments (waiting/confirming/
   * confirmed/sending/finished/partially_paid/failed/expired/refunded) pro
   * vocabulário que processPaymentCallback entende. Só "finished" volta
   * "PAID" (confirmado) — os demais em voo (waiting/confirming/confirmed/
   * sending/partially_paid) passam como pending (uppercased, sem tradução):
   * a NOWPayments recomenda explicitamente NÃO entregar produto em
   * confirming/confirmed. Usado tanto pelo webhook (IPN) quanto pelo poller
   * de fallback — mantém os dois caminhos sincronizados na mesma tradução.
   */
  static mapPaymentStatus(rawStatus: string): string {
    const s = rawStatus.toLowerCase();
    if (s === "finished") return "PAID";
    if (s === "failed" || s === "expired") return "FAILED";
    if (s === "refunded") return "REFUNDED";
    return s.toUpperCase();
  }

  /**
   * Ordena recursivamente as chaves de objetos (arrays mantêm a ordem dos
   * elementos — só as chaves de objetos DENTRO deles são ordenadas). Passo
   * obrigatório antes de serializar pro HMAC do IPN: a NOWPayments exige
   * exatamente essa canonicalização do lado de quem valida.
   */
  private static sortObjectDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => NowPayments.sortObjectDeep(v));
    }
    if (value !== null && typeof value === "object") {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = NowPayments.sortObjectDeep((value as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return value;
  }

  /**
   * Valida o header x-nowpayments-sig: HMAC-SHA512 hex do corpo JSON com
   * TODAS as chaves (inclusive aninhadas) ordenadas alfabeticamente, sem
   * espaços. Esquema DIFERENTE do EvPay/ZuckPay (que assinam o buffer bruto
   * recebido) — aqui a entrada é o body JÁ PARSEADO, reserializado de forma
   * canônica. Ver nota de risco no plano: `JSON.stringify(JSON.parse(raw))`
   * não é garantidamente byte-idêntico ao que a NOWPayments assinou — validar
   * contra um IPN real de sandbox antes de exigir em produção.
   */
  static verifySignature(body: Record<string, unknown>, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    const canonical = JSON.stringify(NowPayments.sortObjectDeep(body));
    const expected = createHmac("sha512", secret).update(canonical).digest("hex");
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  }
}
