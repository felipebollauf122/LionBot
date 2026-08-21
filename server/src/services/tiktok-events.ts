import { createHash } from "crypto";

/**
 * TikTok Events API (Conversions API server-side) v1.3 / Events API 2.0.
 *
 * ATENCAO — o shape abaixo foi reconstruido cruzando docs de terceiros que
 * implementam o wire format real (CommandersAct, mParticle, Segment/Twilio,
 * TikTok For Business/help center) porque o portal autenticado
 * (business-api.tiktok.com/portal/docs) é uma SPA que não renderiza pra
 * fetch — não pôde ser acessado durante a implementação nem na auditoria
 * de 2026-08-21 que corrigiu user.phone (era phone_number), o "+" no E.164,
 * o shape de contents[] (era o do Facebook) e o rename CompletePayment→
 * Purchase. Essas fontes convergem e citam a doc de rate-limits oficial
 * (code=40100), mas SEM um teste real via test_event_code (suportado desde
 * essa auditoria — ver TIKTOK_TEST_EVENT_CODE em sendEvent) nada aqui está
 * 100% confirmado. Validar no TikTok Events Manager → Test Events antes de
 * confiar cegamente em produção.
 *
 * Mirrors a estrutura de facebook-capi.ts (isConfigured gate, hash SHA-256,
 * buildUserData, retry com backoff em 5xx/429/rate-limit), mas sem o
 * conceito de pixel reserva (só um destino por bot) e com normalizações
 * PRÓPRIAS onde o spec diverge do Meta — ver comentários em
 * validatePhoneE164 e EventContent.
 */

interface UserData {
  externalIds?: string[];
  email?: string;
  phone?: string;
  /** raw, from ttclid URL param — NÃO é hasheado pelo spec da TikTok */
  ttclid?: string;
  /** raw, from _ttp cookie — NÃO é hasheado pelo spec da TikTok */
  ttp?: string;
  clientIp?: string;
  clientUserAgent?: string;
}

/**
 * Shape do "contents" da TikTok — DIFERENTE do Facebook (que usa
 * {id, quantity, item_price}). Confirmado cruzando docs de terceiros que
 * implementam o wire format real (mParticle: mapeia pra content_id/price/
 * quantity/content_category/content_name). O caller (tracking-service.ts)
 * monta um array próprio pra cada rede — nunca reusar o array do Facebook
 * aqui.
 */
interface EventContent {
  content_id: string;
  content_type?: string;
  content_name?: string;
  price: number; // preço unitário, na moeda principal (não centavos)
  quantity: number;
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
  /** Tag de log — inclui botId quando disponível, pra distinguir bots num log compartilhado. */
  private readonly tag: string;

  constructor(
    private pixelId: string,
    private accessToken: string,
    botId?: string,
  ) {
    this.tag = botId ? `[tiktok-events:${botId}]` : "[tiktok-events]";
  }

  /**
   * Configuração AUSENTE (nem pixel nem token) é o caso normal pra bot sem
   * TikTok — silencioso de propósito. Configuração PARCIAL (só um dos dois)
   * é sempre erro de operador (colou errado, apagou um campo) e fica muda
   * pra sempre sem esse warn — mesmo padrão de utmify.ts.
   */
  private isConfigured(): boolean {
    const hasPixel = Boolean(this.pixelId);
    const hasToken = Boolean(this.accessToken);
    if (hasPixel !== hasToken) {
      console.warn(
        `${this.tag} configuração parcial (pixel_id ${hasPixel ? "presente" : "AUSENTE"}, access_token ${hasToken ? "presente" : "AUSENTE"}) — nenhum evento será enviado até os dois campos estarem preenchidos`,
      );
    }
    return hasPixel && hasToken;
  }

  /** SHA-256 hash a value for TikTok's normalization requirements */
  private hash(value: string): string {
    return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
  }

  /**
   * Valida e normaliza telefone pro padrão E.164 brasileiro. Retorna com o
   * "+" (E.164 de verdade é "+" + até 15 dígitos, por definição do padrão
   * ITU-T) ou null se inválido/placeholder (e loga).
   *
   * DIVERGE de facebook-capi.ts de propósito: o Meta hasheia só dígitos,
   * sem "+". A TikTok normaliza e hasheia com "+" (confirmado cruzando
   * docs de terceiros que implementam o wire format real — CommandersAct,
   * mParticle, Segment). Não copiar um formato pro outro.
   */
  private validatePhoneE164(input: string | undefined): string | null {
    if (!input) return null;
    const digits = input.replace(/\D/g, "");
    if (digits.length === 0) return null;
    const e164 = digits.startsWith("55") ? digits : `55${digits}`;
    if (e164.length < 12 || e164.length > 15) {
      console.warn(`${this.tag} phone "${input}" rejeitado: comprimento E.164 inválido (${e164.length})`);
      return null;
    }
    if (/^55(11)?9{8,}$/.test(e164) || /^(\d)\1+$/.test(e164.slice(2))) {
      console.warn(`${this.tag} phone "${input}" rejeitado: placeholder`);
      return null;
    }
    return `+${e164}`;
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
    // Campo "phone" (não "phone_number" — esse é o nome da Events API 1.0
    // legada, /pixel/track/; a 2.0/v1.3 (endpoint que este arquivo usa)
    // renomeou pra "phone". Confirmado cruzando docs de terceiros que
    // implementam o wire format real (CommandersAct).
    const validPhone = this.validatePhoneE164(params.phone);
    if (validPhone) ud.phone = this.hash(validPhone);

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

  /** Preenche content_id (singular, primeiro item) + content_ids (array completo) —
   *  a doc oficial é ambígua sobre qual dos dois é lido, então manda os dois
   *  (aditivo, não quebra nada). content_name vira `description`: o nome
   *  correto pra rótulo de produto solto em properties é esse — `content_name`
   *  só existe DENTRO de cada item de `contents[]`. */
  private buildContentProperties(contentIds: string[] | undefined, contentName: string | undefined): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    if (contentIds?.length) {
      properties.content_id = contentIds[0];
      properties.content_ids = contentIds;
    }
    if (contentName) properties.description = contentName;
    return properties;
  }

  async sendCompletePaymentEvent(params: CompletePaymentEventParams): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const value = Number(params.value);
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`${this.tag} Refusing to send Purchase with invalid value=${params.value}`);
      return false;
    }

    const properties: Record<string, unknown> = {
      content_type: "product",
      currency: params.currency.toUpperCase(),
      value,
      ...this.buildContentProperties(params.contentIds, params.contentName),
    };
    if (params.contents?.length) properties.contents = params.contents;
    if (params.orderId) properties.order_id = params.orderId;

    return this.sendEvent({
      // Renomeado de "CompletePayment" pra "Purchase" no rollout de eventos
      // padrão da TikTok (ago/set 2025). O nome legado continua aceito e
      // remapeado internamente até 2027, mas todo setup novo deve usar o
      // nome atual — confirmado via TikTok For Business (padronização de
      // nomenclatura entre pixel web, Events API, CRM e offline).
      event: "Purchase",
      event_time: params.eventTime,
      event_id: params.eventId,
      user: this.buildUserData(params.userData),
      properties,
      ...(params.sourceUrl ? { page: { url: params.sourceUrl } } : {}),
    });
  }

  async sendInitiateCheckoutEvent(params: InitiateCheckoutEventParams): Promise<boolean> {
    if (!this.isConfigured()) return false;

    // Mesma guarda de sendCompletePaymentEvent — o valor aqui é sempre o
    // preço do produto (Pix gerado), nunca 0/negativo por design; um valor
    // assim é sinal de bug upstream, não um evento legítimo de valor livre.
    const value = Number(params.value);
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`${this.tag} Refusing to send InitiateCheckout with invalid value=${params.value}`);
      return false;
    }

    const properties: Record<string, unknown> = {
      content_type: "product",
      currency: params.currency.toUpperCase(),
      value,
      ...this.buildContentProperties(params.contentIds, params.contentName),
    };

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
      eventData.properties = { content_type: "product", description: params.contentName };
    }
    if (params.sourceUrl) eventData.page = { url: params.sourceUrl };

    return this.sendEvent(eventData);
  }

  /** Envia o evento à TikTok Events API, com retry em 5xx/429/rate-limit lógico. */
  private async sendEvent(eventData: Record<string, unknown>, maxRetries = 3): Promise<boolean> {
    const eventName = String(eventData.event);
    const apiUrl = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
    const tag = this.tag;
    // Permite testar no TikTok Events Manager → Test Events sem sujar
    // dados de produção. Setar TIKTOK_TEST_EVENT_CODE (formato TEST12345,
    // gerado no próprio Events Manager) durante a validação e remover
    // depois — sem isso não tem como confirmar o shape do payload contra
    // um evento real (ver cabeçalho do arquivo).
    const testEventCode = process.env.TIKTOK_TEST_EVENT_CODE?.trim();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt === 1) {
          console.log(`${tag} Sending ${eventName} event (event_id=${eventData.event_id})...`);
        } else {
          console.log(`${tag} Retrying ${eventName} (attempt ${attempt}/${maxRetries}, event_id=${eventData.event_id})...`);
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
            ...(testEventCode ? { test_event_code: testEventCode } : {}),
          }),
        });

        const result = await response.json();

        if (response.ok && result?.code === 0) {
          console.log(`${tag} ✓ ${eventName} sent (event_id=${eventData.event_id})`);
          return true;
        }

        // Retry em erro de servidor (5xx), rate-limit HTTP (429) E rate-limit
        // "lógico" — a Business API costuma responder HTTP 200 com o erro só
        // no corpo (code=40100 = throttle QPM/QPD, confirmado na doc oficial
        // de rate limits). Checar só o status HTTP deixava esse caso, que é
        // o mais comum em produção, sem retry nenhum.
        const shouldRetry = response.status >= 500 || response.status === 429 || result?.code === 40100;
        if (shouldRetry && attempt < maxRetries) {
          const delayMs = Math.min(Math.pow(2, attempt) * 500, 5000);
          console.warn(`${tag} ${eventName} (event_id=${eventData.event_id}) failed with ${response.status}, retrying in ${delayMs}ms. Response: ${JSON.stringify(result)}`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        console.error(`${tag} ✗ ${eventName} failed (event_id=${eventData.event_id}, ${response.status}, code=${result?.code}, no retry):`, JSON.stringify(result));
        return false;
      } catch (error) {
        const isLast = attempt >= maxRetries;
        if (!isLast) {
          const delayMs = Math.min(Math.pow(2, attempt) * 500, 5000);
          console.warn(`${tag} ${eventName} (event_id=${eventData.event_id}) network error (attempt ${attempt}), retrying in ${delayMs}ms:`, error);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        console.error(`${tag} ✗ ${eventName} (event_id=${eventData.event_id}) request failed after ${maxRetries} attempts:`, error);
        return false;
      }
    }

    return false;
  }
}
