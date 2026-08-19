import { createHash } from "crypto";

/**
 * TikTok Events API (Conversions API server-side) v1.3.
 *
 * ATENCAO — o shape abaixo foi reconstruido cruzando docs de terceiros
 * (mParticle, artigos da própria TikTok Business, blogs) porque o portal
 * autenticado da TikTok não pôde ser acessado durante a implementação.
 * Validar com um evento de teste real (test_event_code + TikTok Events
 * Manager "Test Events") antes de confiar 100% em produção.
 *
 * Mirrors a estrutura de facebook-capi.ts (isConfigured gate, hash SHA-256,
 * validatePhoneE164, buildUserData, retry com backoff em 5xx/429), mas sem
 * o conceito de pixel reserva — só um destino por bot.
 */

interface UserData {
  externalIds?: string[];
  email?: string;
  phone?: string;
  /** raw, from tt_clid URL param — NÃO é hasheado pelo spec da TikTok */
  ttclid?: string;
  /** raw, from _ttp cookie — NÃO é hasheado pelo spec da TikTok */
  ttp?: string;
  clientIp?: string;
  clientUserAgent?: string;
}

interface EventContent {
  id: string;
  quantity: number;
  item_price: number; // in the currency's main unit
}

interface CompletePaymentEventParams {
  eventTime: number;
  userData: UserData;
  value: number; // in the currency's main unit (e.g. BRL reais, not cents)
  currency: string;
  eventId: string;
  contentIds?: string[];
  contentName?: string;
  contents?: EventContent[];
  sourceUrl?: string;
  orderId?: string;
}

interface InitiateCheckoutEventParams {
  eventTime: number;
  userData: UserData;
  value: number;
  currency: string;
  eventId: string;
  contentIds?: string[];
  contentName?: string;
  sourceUrl?: string;
}

interface ContactEventParams {
  eventTime: number;
  userData: UserData;
  eventId: string;
  sourceUrl?: string;
}

interface ViewContentEventParams {
  eventTime: number;
  userData: UserData;
  eventId: string;
  contentName?: string;
  sourceUrl?: string;
}

export class TiktokEvents {
  constructor(
    private pixelId: string,
    private accessToken: string,
  ) {}

  private isConfigured(): boolean {
    return Boolean(this.pixelId && this.accessToken);
  }

  /** SHA-256 hash a value for TikTok's normalization requirements */
  private hash(value: string): string {
    return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
  }

  /**
   * Valida e normaliza telefone pro padrão E.164 brasileiro. Retorna só
   * dígitos com country code, ou null se inválido/placeholder (e loga).
   * (Mesma lógica de facebook-capi.ts.)
   */
  private validatePhoneE164(input: string | undefined): string | null {
    if (!input) return null;
    const digits = input.replace(/\D/g, "");
    if (digits.length === 0) return null;
    const e164 = digits.startsWith("55") ? digits : `55${digits}`;
    if (e164.length < 12 || e164.length > 15) {
      console.warn(`[tiktok-events] phone "${input}" rejeitado: comprimento E.164 inválido (${e164.length})`);
      return null;
    }
    if (/^55(11)?9{8,}$/.test(e164) || /^(\d)\1+$/.test(e164.slice(2))) {
      console.warn(`[tiktok-events] phone "${input}" rejeitado: placeholder`);
      return null;
    }
    return e164;
  }

  /** Build user object with proper hashing per TikTok spec */
  private buildUserData(params: UserData): Record<string, unknown> {
    const ud: Record<string, unknown> = {};

    if (params.externalIds && params.externalIds.length > 0) {
      ud.external_id = params.externalIds.map((id) => this.hash(id));
    }
    if (params.email) {
      const trimmed = params.email.trim();
      if (trimmed.length > 0 && !trimmed.endsWith("@eaglebot.temp")) {
        ud.email = this.hash(trimmed);
      }
    }
    const validPhone = this.validatePhoneE164(params.phone);
    if (validPhone) ud.phone_number = this.hash(validPhone);

    // ttclid/ttp: raw, NÃO hasheados (spec da TikTok)
    if (params.ttclid) ud.ttclid = params.ttclid;
    if (params.ttp) ud.ttp = params.ttp;

    // IP e User-Agent também raw
    if (params.clientIp && params.clientIp.length > 0) {
      ud.ip = params.clientIp;
    }
    if (params.clientUserAgent && params.clientUserAgent.length > 0) {
      ud.user_agent = params.clientUserAgent;
    }

    return ud;
  }

  async sendCompletePaymentEvent(params: CompletePaymentEventParams): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const value = Number(params.value);
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`[tiktok-events] Refusing to send CompletePayment with invalid value=${params.value}`);
      return false;
    }

    const properties: Record<string, unknown> = {
      content_type: "product",
      currency: params.currency.toUpperCase(),
      value,
    };
    if (params.contentIds?.length) properties.content_id = params.contentIds[0];
    if (params.contentName) properties.content_name = params.contentName;
    if (params.contents?.length) properties.contents = params.contents;
    if (params.orderId) properties.order_id = params.orderId;

    return this.sendEvent({
      event: "CompletePayment",
      event_time: params.eventTime,
      event_id: params.eventId,
      user: this.buildUserData(params.userData),
      properties,
      ...(params.sourceUrl ? { page: { url: params.sourceUrl } } : {}),
    });
  }

  async sendInitiateCheckoutEvent(params: InitiateCheckoutEventParams): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const properties: Record<string, unknown> = {
      content_type: "product",
      currency: params.currency.toUpperCase(),
      value: params.value,
    };
    if (params.contentIds?.length) properties.content_id = params.contentIds[0];
    if (params.contentName) properties.content_name = params.contentName;

    return this.sendEvent({
      event: "InitiateCheckout",
      event_time: params.eventTime,
      event_id: params.eventId,
      user: this.buildUserData(params.userData),
      properties,
      ...(params.sourceUrl ? { page: { url: params.sourceUrl } } : {}),
    });
  }

  async sendContactEvent(params: ContactEventParams): Promise<boolean> {
    if (!this.isConfigured()) return false;

    return this.sendEvent({
      event: "Contact",
      event_time: params.eventTime,
      event_id: params.eventId,
      user: this.buildUserData(params.userData),
      ...(params.sourceUrl ? { page: { url: params.sourceUrl } } : {}),
    });
  }

  async sendViewContentEvent(params: ViewContentEventParams): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const eventData: Record<string, unknown> = {
      event: "ViewContent",
      event_time: params.eventTime,
      event_id: params.eventId,
      user: this.buildUserData(params.userData),
    };
    if (params.contentName) {
      eventData.properties = { content_type: "product", content_name: params.contentName };
    }
    if (params.sourceUrl) eventData.page = { url: params.sourceUrl };

    return this.sendEvent(eventData);
  }

  /** Envia o evento à TikTok Events API, com retry em 5xx/429. */
  private async sendEvent(eventData: Record<string, unknown>, maxRetries = 3): Promise<boolean> {
    const eventName = String(eventData.event);
    const apiUrl = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
    const tag = "[tiktok-events]";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt === 1) {
          console.log(`${tag} Sending ${eventName} event (event_id=${eventData.event_id})...`);
        } else {
          console.log(`${tag} Retrying ${eventName} (attempt ${attempt}/${maxRetries})...`);
        }

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Access-Token": this.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event_source: "web",
            event_source_id: this.pixelId,
            data: [eventData],
          }),
        });

        const result = await response.json();

        if (response.ok && result?.code === 0) {
          console.log(`${tag} ✓ ${eventName} sent (event_id=${eventData.event_id})`);
          return true;
        }

        // Retry on server errors (5xx) and rate limits (429), but NOT on
        // other 4xx nem em falha "lógica" (HTTP 200 com code != 0).
        const shouldRetry = response.status >= 500 || response.status === 429;
        if (shouldRetry && attempt < maxRetries) {
          const delayMs = Math.min(Math.pow(2, attempt) * 500, 5000);
          console.warn(`${tag} ${eventName} failed with ${response.status}, retrying in ${delayMs}ms. Response: ${JSON.stringify(result)}`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        console.error(`${tag} ✗ ${eventName} failed (${response.status}, code=${result?.code}, no retry):`, JSON.stringify(result));
        return false;
      } catch (error) {
        const isLast = attempt >= maxRetries;
        if (!isLast) {
          const delayMs = Math.min(Math.pow(2, attempt) * 500, 5000);
          console.warn(`${tag} ${eventName} network error (attempt ${attempt}), retrying in ${delayMs}ms:`, error);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        console.error(`${tag} ✗ ${eventName} request failed after ${maxRetries} attempts:`, error);
        return false;
      }
    }

    return false;
  }
}
