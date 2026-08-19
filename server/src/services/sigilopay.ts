import type {
  CreatePixPaymentParams,
  PaymentGateway,
  PixPaymentResult,
} from "./payment-gateway.js";

export class SigiloPay implements PaymentGateway {
  private baseUrl = "https://app.poseidonpay.site/api/v1";

  constructor(
    private publicKey: string,
    private secretKey: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.publicKey && this.secretKey);
  }

  async createPixPayment(params: CreatePixPaymentParams): Promise<PixPaymentResult> {
    if (!this.isConfigured()) {
      throw new Error("Chaves Poseidon Pay não configuradas. Vá em Configurações do bot e preencha a Public Key e Secret Key.");
    }

    const payload: Record<string, unknown> = {
      identifier: params.identifier,
      amount: params.amount,
      client: {
        name: params.clientName,
        email: params.clientEmail,
        phone: params.clientPhone,
        document: params.clientDocument,
      },
      callbackUrl: params.callbackUrl,
      metadata: params.metadata,
    };

    if (params.products && params.products.length > 0) {
      payload.products = params.products;
    }

    console.log(`[sigilopay] Payload enviado:`, JSON.stringify(payload, null, 2));
    console.log(
      `[sigilopay] Auth: url=${this.baseUrl}/gateway/pix/receive | pub_len=${this.publicKey.length} pub_prefix="${this.publicKey.slice(0, 8)}" pub_suffix="${this.publicKey.slice(-4)}" | sec_len=${this.secretKey.length} sec_prefix="${this.secretKey.slice(0, 8)}" sec_suffix="${this.secretKey.slice(-4)}"`,
    );

    const response = await fetch(`${this.baseUrl}/gateway/pix/receive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (eaglebot-server/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "x-public-key": this.publicKey,
        "x-secret-key": this.secretKey,
      },
      body: JSON.stringify(payload),
      // Timeout pra não pendurar a geração do PIX (e o cliente no Telegram)
      // caso a Poseidon esteja lenta/rate-limitada. Sem isso o fetch fica
      // preso ~300s no pool do undici. Mesmo valor de EvPay/ZuckPay.
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      const server = response.headers.get("server") ?? "unknown";
      const cfRay = response.headers.get("cf-ray") ?? "none";
      console.error(
        `[poseidonpay] Erro ${response.status} ${response.statusText} | server=${server} cf-ray=${cfRay} | body: ${rawBody.slice(0, 500)}`,
      );
      let msg: string | unknown = response.statusText;
      const looksLikeHtml = rawBody.trim().startsWith("<");
      if (looksLikeHtml) {
        msg = `bloqueado pelo Cloudflare/WAF (server=${server}, cf-ray=${cfRay})`;
      } else {
        try {
          const parsed = JSON.parse(rawBody) as Record<string, unknown>;
          msg = parsed.message ?? parsed.errorCode ?? response.statusText;
        } catch {
          msg = rawBody.slice(0, 200) || response.statusText;
        }
      }
      throw new Error(`Poseidon Pay API erro (${response.status}): ${msg}`);
    }

    const data = await response.json();
    console.log(`[poseidonpay] Pix payment created, txn ${data.transactionId}`);
    return {
      transactionId: data.transactionId,
      status: data.status,
      pixCode: data.pix.code,
      pixImage: data.pix.image ?? null,
      orderId: data.order.id,
    };
  }

  /**
   * Consulta status atual de uma transação. Usado pelo poller pra
   * verificar pagamentos quando o webhook automático não chega.
   *
   * Como a Poseidon não documenta um endpoint canônico, tenta os mais
   * prováveis em ordem: /gateway/pix/{id}, /gateway/transactions/{id},
   * /gateway/order/{id}. Retorna null se nenhum bater (404) ou se houver
   * erro de auth/rede.
   */
  async getPaymentStatus(externalId: string): Promise<{ status: string } | null> {
    if (!this.isConfigured()) return null;
    const candidates = [
      `${this.baseUrl}/gateway/pix/${encodeURIComponent(externalId)}`,
      `${this.baseUrl}/gateway/transactions/${encodeURIComponent(externalId)}`,
      `${this.baseUrl}/gateway/order/${encodeURIComponent(externalId)}`,
    ];
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (eaglebot-server/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "x-public-key": this.publicKey,
            "x-secret-key": this.secretKey,
          },
          // Idem: 3 candidatos em série sem timeout podiam segurar o poller
          // por minutos. 10s por tentativa.
          signal: AbortSignal.timeout(10_000),
        });
        // 404 = endpoint não existe nesse caminho, tenta próximo.
        // 403 = Cloudflare/WAF (endpoint não foi liberado pra consulta),
        //       não vale a pena logar pra cada chamada — segue.
        if (response.status === 404 || response.status === 403) continue;
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.warn(
            `[poseidonpay] getPaymentStatus(${externalId}) ${url} → ${response.status}: ${body.slice(0, 200)}`,
          );
          continue;
        }
        const data = (await response.json()) as Record<string, unknown>;
        // Extrai status do payload — tenta vários campos comuns
        const status = String(
          data.status ??
            (data.transaction as Record<string, unknown> | undefined)?.status ??
            (data.order as Record<string, unknown> | undefined)?.status ??
            (data.data as Record<string, unknown> | undefined)?.status ??
            "",
        );
        if (!status) {
          console.warn(`[poseidonpay] getPaymentStatus(${externalId}) ${url} sem campo status:`, JSON.stringify(data).slice(0, 200));
          continue;
        }
        return { status };
      } catch (err) {
        console.warn(`[poseidonpay] getPaymentStatus(${externalId}) ${url} erro:`, err);
        continue;
      }
    }
    return null;
  }
}
