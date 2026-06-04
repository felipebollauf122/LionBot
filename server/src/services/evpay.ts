import { createHmac } from "crypto";
import type {
  CreatePixPaymentParams,
  PaymentGateway,
  PixPaymentResult,
} from "./payment-gateway.js";

interface EvPayCreatePaymentResponse {
  success: boolean;
  data?: {
    id: string;
    status: string;
    amount: number;
    feeAmount: number;
    netAmount: number;
    splitAmount: number;
    externalId: string;
    paymentMethod: string;
    pixQrCode: string;
    boletoUrl: string;
    boletoBarcode: string;
    createdAt: string;
  };
  message?: string;
}

interface EvPayCreateWebhookResponse {
  success: boolean;
  data?: { id: string };
  message?: string;
}

export class EvPay implements PaymentGateway {
  private baseUrl = "https://www.yvepay.com/api";

  constructor(
    private apiKey: string,
    private projectId: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.projectId);
  }

  async createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "EvPay não configurado. Vá em Configurações do bot e preencha a API Key e o Project ID.",
      );
    }

    // Description: usa o primeiro produto (name + description, se houver).
    // O caller já passa name=ghost_name||name e description=ghost_description||description.
    const firstProduct = params.products?.[0];
    const description = firstProduct
      ? firstProduct.description
        ? `${firstProduct.name} — ${firstProduct.description}`
        : firstProduct.name
      : `Pedido ${params.identifier}`;

    const payload: Record<string, unknown> = {
      method: "PIX",
      amount: params.amount,
      customerName: params.clientName,
      customerEmail: params.clientEmail,
      customerPhone: params.clientPhone,
      customerDocument: params.clientDocument,
      description,
    };

    if (params.metadata && Object.keys(params.metadata).length > 0) {
      payload.metadata = params.metadata;
    }

    console.log(`[evpay] Creating PIX payment for project ${this.projectId}`);
    console.log(`[evpay] Payload enviado:`, JSON.stringify(payload, null, 2));

    const response = await fetch(
      `${this.baseUrl}/projects/${this.projectId}/payments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(payload),
      },
    );

    const rawBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(`[evpay] response status=${response.status} body=${JSON.stringify(rawBody)}`);

    if (!response.ok) {
      const msg =
        (rawBody as { message?: string }).message ?? response.statusText ?? "erro desconhecido";
      console.error(`[evpay] createPixPayment failed (${response.status}):`, msg);
      throw new Error(`EvPay erro (${response.status}): ${msg}`);
    }

    // Lê de várias formas: {data: {...}}, ou flat ({...}), ou {payment: {...}} etc.
    const candidates: Array<Record<string, unknown> | undefined> = [
      (rawBody as { data?: Record<string, unknown> }).data,
      (rawBody as { payment?: Record<string, unknown> }).payment,
      (rawBody as { transaction?: Record<string, unknown> }).transaction,
      rawBody,
    ];
    const data =
      candidates.find(
        (c) => c && typeof c === "object" && (c.id || c.transactionId),
      ) ?? {};

    // Yvepay retorna PIX em data.methodData.pix.qrCode.emv (BRcode)
    // e a imagem do QR em data.methodData.pix.qrCode.image
    const methodData = (data as { methodData?: Record<string, unknown> }).methodData ?? {};
    const pixContainer =
      ((methodData as { pix?: Record<string, unknown> }).pix ?? {}) as Record<string, unknown>;
    const qrCode =
      ((pixContainer as { qrCode?: Record<string, unknown> }).qrCode ?? {}) as Record<string, unknown>;

    const transactionId = String(
      (data as { id?: unknown }).id ??
      (data as { transactionId?: unknown }).transactionId ??
      "",
    );
    const status = String((data as { status?: unknown }).status ?? "PENDING");
    const pixCode = String(
      (qrCode as { emv?: unknown }).emv ??
      (data as { pixQrCode?: unknown }).pixQrCode ??
      (data as { pix_qr_code?: unknown }).pix_qr_code ??
      (data as { pixCode?: unknown }).pixCode ??
      (data as { brCode?: unknown }).brCode ??
      "",
    );
    const pixImage =
      String((qrCode as { image?: unknown }).image ?? "") || null;
    const externalId = String(
      (data as { externalId?: unknown }).externalId ??
      (data as { external_id?: unknown }).external_id ??
      "",
    );

    if (!transactionId) {
      console.error(`[evpay] response missing transaction id. body:`, JSON.stringify(rawBody));
      throw new Error(`EvPay devolveu resposta sem id de transação. Verifique a chave/projeto.`);
    }
    if (!pixCode) {
      console.error(`[evpay] response missing pix code. body:`, JSON.stringify(rawBody));
      throw new Error(`EvPay devolveu resposta sem código PIX.`);
    }

    console.log(`[evpay] PIX created, txn ${transactionId}`);

    return {
      transactionId,
      status,
      pixCode,
      pixImage,
      orderId: externalId || transactionId,
    };
  }

  /**
   * Registra (ou re-registra) o webhook no EvPay.
   * Idempotente: se já existir webhook com a mesma URL, EvPay devolve 409;
   * tratamos como sucesso.
   */
  async registerWebhook(url: string, secret: string): Promise<{ webhookId: string | null }> {
    if (!this.isConfigured()) {
      throw new Error("EvPay não configurado");
    }

    const response = await fetch(
      `${this.baseUrl}/projects/${this.projectId}/webhooks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify({
          name: "EagleBot",
          url,
          secret,
          events: ["pix.in.confirmation"],
        }),
      },
    );

    if (response.status === 409) {
      console.log(`[evpay] Webhook already registered for ${url} (409 — ok)`);
      return { webhookId: null };
    }

    const body = (await response.json().catch(() => ({}))) as EvPayCreateWebhookResponse;
    if (!response.ok || !body.success) {
      const msg = body.message ?? response.statusText ?? "erro desconhecido";
      throw new Error(`EvPay webhook erro (${response.status}): ${msg}`);
    }
    return { webhookId: body.data?.id ?? null };
  }

  /**
   * Consulta o status atual de uma transação. Usado pelo poller pra
   * detectar pagamentos quando o webhook automático não dispara.
   */
  async getPaymentStatus(transactionId: string): Promise<{ status: string } | null> {
    if (!this.isConfigured()) throw new Error("EvPay não configurado");
    const response = await fetch(
      `${this.baseUrl}/projects/${this.projectId}/payments/${transactionId}`,
      {
        method: "GET",
        headers: { "X-API-Key": this.apiKey },
      },
    );
    if (response.status === 404) return null;
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { status?: string };
      message?: string;
    };
    if (!response.ok || !body.success || !body.data) {
      console.error(`[evpay] getPaymentStatus(${transactionId}) failed (${response.status}): ${body.message ?? response.statusText}`);
      return null;
    }
    return { status: String(body.data.status ?? "") };
  }

  /**
   * Lista webhooks registrados no projeto. Útil pra diagnóstico —
   * checa se o nosso URL realmente está cadastrado.
   */
  async listWebhooks(): Promise<Array<{ id: string; url: string; events: string[]; isActive: boolean }>> {
    if (!this.isConfigured()) throw new Error("EvPay não configurado");
    const response = await fetch(
      `${this.baseUrl}/projects/${this.projectId}/webhooks`,
      {
        method: "GET",
        headers: { "X-API-Key": this.apiKey },
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: Array<{ id: string; url: string; events: string[]; isActive: boolean }>;
      message?: string;
    };
    if (!response.ok || !body.success) {
      throw new Error(`EvPay listWebhooks erro (${response.status}): ${body.message ?? response.statusText}`);
    }
    return body.data ?? [];
  }

  /**
   * Apaga um webhook do projeto pelo id. Usado quando a URL cadastrada está
   * errada (ex: domínio antigo) e precisamos re-registrar com a URL correta.
   */
  async deleteWebhook(webhookId: string): Promise<boolean> {
    if (!this.isConfigured()) throw new Error("EvPay não configurado");
    const response = await fetch(
      `${this.baseUrl}/projects/${this.projectId}/webhooks/${webhookId}`,
      {
        method: "DELETE",
        headers: { "X-API-Key": this.apiKey },
      },
    );
    return response.ok || response.status === 404;
  }

  /**
   * Valida o header X-Webhook-Signature (HMAC-SHA256 hex do raw body com o secret).
   */
  static verifySignature(rawBody: string, signature: string, secret: string): boolean {
    if (!signature || !secret) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    // Compare por tamanho primeiro pra evitar timing attack óbvio; pra caso de uso
    // de webhook é suficiente.
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  }
}
