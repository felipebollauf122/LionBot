import type { SupabaseClient } from "@supabase/supabase-js";
import type { FacebookCapi } from "./facebook-capi.js";
import type { UtmifyService } from "./utmify.js";
import { geoLookup } from "./geoip.js";

interface LeadInfo {
  id: string;
  tid: string | null;
  fbclid: string | null;
  firstName: string;
  lastName?: string | null;
  email?: string;
  phone?: string;
  document?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  telegramUserId?: number;
  botId?: string;
}

interface TrackPurchaseParams {
  tenantId: string;
  leadId: string;
  botId: string;
  transactionId: string;
  amount: number; // in cents
  currency: string;
  lead: LeadInfo;
  customerDocument?: string;
  productId?: string;
  productName?: string;
  paidAtIso?: string; // transaction.paid_at — usado como event_time (#5)
}

interface TrackCheckoutParams {
  tenantId: string;
  leadId: string;
  botId: string;
  amount: number; // in cents
  currency: string;
  lead: LeadInfo;
  productId?: string;
  productName?: string;
}

interface TrackLeadParams {
  tenantId: string;
  leadId: string;
  botId: string;
  lead: LeadInfo;
}

interface TrackViewOfferParams {
  tenantId: string;
  leadId: string;
  botId: string;
  lead: LeadInfo;
  contentName?: string;
}

interface TrackEventParams {
  tenantId: string;
  leadId: string | null;
  botId: string;
  eventType: string;
  fbclid: string | null;
  tid: string | null;
  utmParams?: Record<string, string>;
  eventData?: Record<string, unknown>;
}

/** Build fbc parameter from fbclid using the REAL click timestamp */
function buildFbc(fbclid: string | null, clickTimeMs: number | null): string {
  if (!fbclid) return "";
  const ts = clickTimeMs && clickTimeMs > 0 ? clickTimeMs : Date.now();
  return `fb.1.${ts}.${fbclid}`;
}

interface ClickContext {
  fbp?: string;
  fbc?: string;
  clickTime?: number;
  clientIp?: string;
  userAgent?: string;
  sourceUrl?: string;
  acceptLanguage?: string;
  referer?: string;
  country?: string;
}

/**
 * Look up the _fbp, _fbc real, click timestamp, IP, UA, accept-language e referer
 * salvos no page_view. Tudo isso vai pro user_data do CAPI Purchase pra
 * maximizar Event Match Quality (EMQ).
 */
async function loadClickContext(
  db: SupabaseClient,
  tid: string | null,
): Promise<ClickContext> {
  if (!tid) return {};
  const { data } = await db
    .from("tracking_events")
    .select("event_data")
    .eq("tid", tid)
    .eq("event_type", "page_view")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ed = (data?.event_data ?? {}) as Record<string, unknown>;
  return {
    fbp: typeof ed.fbp === "string" ? ed.fbp : undefined,
    fbc: typeof ed.fbc === "string" ? ed.fbc : undefined,
    clickTime: typeof ed.click_time === "number" ? ed.click_time : undefined,
    clientIp: typeof ed.client_ip === "string" ? ed.client_ip : undefined,
    userAgent: typeof ed.user_agent === "string" ? ed.user_agent : undefined,
    sourceUrl: typeof ed.source_url === "string" ? ed.source_url : undefined,
    acceptLanguage: typeof ed.accept_language === "string" ? ed.accept_language : undefined,
    referer: typeof ed.referer === "string" ? ed.referer : undefined,
    country: typeof ed.country === "string" ? ed.country : undefined,
  };
}

/**
 * external_ids — array com múltiplos formatos do mesmo usuário.
 * Cada string é hasheada SHA-256 pelo CAPI. Mais IDs = mais chance
 * do índice do Meta encontrar match → EMQ sobe.
 */
function buildExternalIds(lead: LeadInfo): string[] {
  const ids = new Set<string>();
  if (lead.telegramUserId && lead.botId) {
    ids.add(`tg_${lead.telegramUserId}_${lead.botId}`);
  }
  if (lead.telegramUserId) {
    ids.add(`tg_${lead.telegramUserId}`);
    ids.add(String(lead.telegramUserId));
  }
  if (lead.id) ids.add(lead.id);
  // CPF como external_id extra (mais vetores de match no Meta) (#10)
  if (lead.document) {
    const cpf = lead.document.replace(/\D/g, "");
    if (cpf.length === 11) ids.add(`cpf_${cpf}`);
  }
  // Telefone E.164 como external_id extra (#10)
  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, "");
    const e164 = digits.startsWith("55") ? digits : `55${digits}`;
    if (e164.length >= 12 && e164.length <= 15) ids.add(`phone_${e164}`);
  }
  return Array.from(ids);
}

/** Build user_data for Facebook from lead info + click context */
function buildFbUserData(lead: LeadInfo, ctx: ClickContext) {
  // Prioridade do fbc: cookie real do navegador (ctx.fbc) → derivado de fbclid
  const derivedFbc = buildFbc(lead.fbclid, ctx.clickTime ?? null);
  const fbc = ctx.fbc || derivedFbc;
  return {
    fbc: fbc || undefined,
    fbp: ctx.fbp,
    externalIds: buildExternalIds(lead),
    firstName: lead.firstName,
    lastName: lead.lastName || undefined,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    clientIp: ctx.clientIp,
    clientUserAgent: ctx.userAgent,
    country: ctx.country || undefined, // geo-IP da tracking page (#14)
  };
}

/** Build UTM params record for DB */
function buildUtmRecord(lead: LeadInfo): Record<string, string> {
  return {
    utm_source: lead.utmSource ?? "",
    utm_medium: lead.utmMedium ?? "",
    utm_campaign: lead.utmCampaign ?? "",
    utm_content: lead.utmContent ?? "",
    utm_term: lead.utmTerm ?? "",
  };
}

export class TrackingService {
  constructor(
    private db: SupabaseClient,
    private facebookCapi: FacebookCapi,
    private utmify: UtmifyService,
  ) {}

  /**
   * Purchase — fires when SigiloPay confirms payment (status OK).
   * Sends: DB event + Facebook Purchase + Utmify paid order.
   *
   * This is the ONLY Facebook CAPI event fired by the platform — all user
   * data (email, phone, CPF, fbc with real click timestamp, fbp) is attached
   * here to maximize Event Match Quality.
   */
  async trackPurchase(params: TrackPurchaseParams): Promise<{ fbSent: boolean }> {
    const eventId = `purchase_${params.transactionId}`;
    // event_time = hora real do pagamento confirmado (paid_at), não a hora
    // de processamento. Fallback pra agora se paid_at não vier (#5).
    const paidMs = params.paidAtIso ? new Date(params.paidAtIso).getTime() : NaN;
    const eventTime = Number.isFinite(paidMs)
      ? Math.floor(paidMs / 1000)
      : Math.floor(Date.now() / 1000);
    const { lead } = params;
    const amountInCurrency = params.amount / 100;

    // Save tracking event in DB
    const dbEventId = await this.saveEvent({
      tenantId: params.tenantId,
      leadId: params.leadId,
      botId: params.botId,
      eventType: "purchase",
      fbclid: lead.fbclid,
      tid: lead.tid,
      utmParams: buildUtmRecord(lead),
      eventData: {
        transaction_id: params.transactionId,
        amount: params.amount,
        currency: params.currency,
      },
    });

    // Load fbp + real click timestamp + IP/UA/sourceUrl from the original page_view
    const clickCtx = await loadClickContext(this.db, lead.tid);

    // Build structured contents array — Meta prefers this over flat content_ids
    const contents = params.productId
      ? [{ id: params.productId, quantity: 1, item_price: amountInCurrency }]
      : undefined;

    // Facebook CAPI — Purchase event (with full user data for max EMQ).
    // subscriptionId = transaction_id reaproveitado num campo extra
    // do user_data → conta como sinal adicional no EMQ.
    // Injeta o CPF (customerDocument) no lead pra virar external_id extra (#10)
    const leadWithDoc: LeadInfo = { ...lead, document: lead.document || params.customerDocument };
    const userData = {
      ...buildFbUserData(leadWithDoc, clickCtx),
      subscriptionId: params.transactionId,
    };
    const fbSent = await this.facebookCapi.sendPurchaseEvent({
      eventTime,
      eventId,
      userData,
      value: amountInCurrency,
      currency: params.currency,
      contentIds: params.productId ? [params.productId] : undefined,
      contentName: params.productName,
      contents,
      numItems: 1,
      sourceUrl: clickCtx.sourceUrl,
      orderId: params.transactionId,
    });

    // Utmify — paid order
    const now = new Date().toISOString();
    const utmifySent = await this.utmify.sendOrder({
      orderId: params.transactionId,
      status: "paid",
      platform: "eaglebot",
      paymentMethod: "pix",
      paidAt: now,
      approvedDate: now,
      customer: {
        name: lead.firstName,
        email: lead.email ?? "",
        phone: lead.phone ?? "",
        document: params.customerDocument ?? "",
      },
      products: [
        {
          id: params.productId ?? params.transactionId,
          // Defesa em profundidade: caller já deve ter passado ghost ou
          // "Product N" via productLabelForExternal. Se mesmo assim chegar
          // vazio, NUNCA usar nome real (que nem está aqui) — só fallback
          // genérico.
          name: params.productName?.trim() || "Product",
          priceInCents: String(params.amount),
          quantity: 1,
        },
      ],
      trackingParameters: {
        src: lead.tid ?? null,
        sck: lead.fbclid ?? null,
        utm_source: lead.utmSource,
        utm_medium: lead.utmMedium,
        utm_campaign: lead.utmCampaign,
        utm_content: lead.utmContent,
        utm_term: lead.utmTerm,
      },
    });

    // Update sent flags
    if (dbEventId) {
      await this.db
        .from("tracking_events")
        .update({ sent_to_facebook: fbSent, sent_to_utmify: utmifySent })
        .eq("id", dbEventId);
    }
    return { fbSent };
  }

  /**
   * Contexto "forte" = veio do anúncio (passou pela tracking page) com os
   * identificadores de maior peso pro Meta: fbp + fbc + IP + UA.
   */
  private hasStrongContext(ctx: ClickContext): boolean {
    return Boolean(ctx.fbp && ctx.fbc && ctx.clientIp && ctx.userAgent);
  }

  /**
   * Resolve estado/cidade do IP do page_view (via ip-api) e grava em
   * event_data.state/.city. Best-effort: silencia qualquer erro e pula se já
   * estiver enriquecido ou sem IP. Lê e regrava o page_view mais recente do tid.
   */
  private async enrichGeo(tid: string | null): Promise<void> {
    try {
      if (!tid) return;
      const { data } = await this.db
        .from("tracking_events")
        .select("id,event_data")
        .eq("tid", tid)
        .eq("event_type", "page_view")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      const ed = (data.event_data ?? {}) as Record<string, unknown>;
      if (ed.state || ed.city) return; // já enriquecido
      const ip = typeof ed.client_ip === "string" ? ed.client_ip : null;
      const geo = await geoLookup(ip);
      if (!geo.state && !geo.city) return;
      await this.db
        .from("tracking_events")
        .update({ event_data: { ...ed, state: geo.state ?? null, city: geo.city ?? null } })
        .eq("id", data.id as string);
    } catch (e) {
      console.error("[geo] enrichGeo falhou:", (e as Error).message);
    }
  }

  /**
   * REVERTIDO 2026-06-03: o disparo de Lead/ViewContent/InitiateCheckout
   * pro Facebook (reativado na Onda 1 EMQ) coincidiu com o bot parar de
   * vender — a campanha estava otimizada pra Purchase e os eventos de
   * funil novos bagunçaram a otimização/entrega (mais lead, menos venda).
   * Voltamos pra estratégia Purchase-ONLY no CAPI, que era o estado que
   * vendia. Os eventos continuam gravando no DB (contadores do dashboard).
   * Pra religar e testar de novo no futuro, mude pra true.
   */
  private static FUNNEL_CAPI_ENABLED = false;

  /**
   * InitiateCheckout — fires when Pix code is generated.
   * Sempre grava no DB. Dispara CAPI só com contexto forte (#2).
   */
  async trackCheckout(params: TrackCheckoutParams): Promise<void> {
    const { lead } = params;
    await this.saveEvent({
      tenantId: params.tenantId,
      leadId: params.leadId,
      botId: params.botId,
      eventType: "checkout",
      fbclid: lead.fbclid,
      tid: lead.tid,
      utmParams: buildUtmRecord(lead),
      eventData: {
        amount: params.amount,
        currency: params.currency,
        product_id: params.productId,
      },
    });

    if (!TrackingService.FUNNEL_CAPI_ENABLED) return;
    const ctx = await loadClickContext(this.db, lead.tid);
    if (this.hasStrongContext(ctx)) {
      await this.facebookCapi
        .sendInitiateCheckoutEvent({
          eventTime: Math.floor(Date.now() / 1000),
          eventId: `checkout_${params.leadId}_${params.productId ?? "x"}`,
          userData: buildFbUserData(lead, ctx),
          value: params.amount / 100,
          currency: params.currency,
          contentIds: params.productId ? [params.productId] : undefined,
          contentName: params.productName,
        })
        .catch((e) => console.error("[tracking] InitiateCheckout CAPI falhou:", e));
    }
  }

  /**
   * Lead — fires when a new lead enters the bot via tracking link.
   * Sempre grava no DB (o /start no bot nunca muda). Dispara CAPI só com
   * contexto forte (#2) — Lead "pelado" sem dado de contato rebaixa EMQ.
   */
  async trackLead(params: TrackLeadParams): Promise<void> {
    const { lead } = params;
    await this.saveEvent({
      tenantId: params.tenantId,
      leadId: params.leadId,
      botId: params.botId,
      eventType: "bot_start",
      fbclid: lead.fbclid,
      tid: lead.tid,
      utmParams: buildUtmRecord(lead),
    });

    // Enriquecimento de GEO (estado/cidade) — fire-and-forget. O IP foi
    // capturado no page_view; resolvemos via ip-api e gravamos state/city de
    // volta no event_data do page_view (pra agregação nas Análises). Nunca
    // bloqueia nem quebra o /start.
    void this.enrichGeo(lead.tid);

    if (!TrackingService.FUNNEL_CAPI_ENABLED) return;
    const ctx = await loadClickContext(this.db, lead.tid);
    if (this.hasStrongContext(ctx)) {
      await this.facebookCapi
        .sendLeadEvent({
          eventTime: Math.floor(Date.now() / 1000),
          eventId: `lead_${params.leadId}`,
          userData: buildFbUserData(lead, ctx),
        })
        .catch((e) => console.error("[tracking] Lead CAPI falhou:", e));
    }
  }

  /**
   * ViewContent — fires when a lead sees the offer (view_offer event).
   * Sempre grava no DB. Dispara CAPI só com contexto forte (#2).
   */
  async trackViewOffer(params: TrackViewOfferParams): Promise<void> {
    const { lead } = params;
    await this.saveEvent({
      tenantId: params.tenantId,
      leadId: params.leadId,
      botId: params.botId,
      eventType: "view_offer",
      fbclid: lead.fbclid,
      tid: lead.tid,
      utmParams: buildUtmRecord(lead),
    });

    if (!TrackingService.FUNNEL_CAPI_ENABLED) return;
    const ctx = await loadClickContext(this.db, lead.tid);
    if (this.hasStrongContext(ctx)) {
      await this.facebookCapi
        .sendViewContentEvent({
          eventTime: Math.floor(Date.now() / 1000),
          eventId: `viewcontent_${params.leadId}`,
          userData: buildFbUserData(lead, ctx),
          contentName: params.contentName,
        })
        .catch((e) => console.error("[tracking] ViewContent CAPI falhou:", e));
    }
  }

  async trackCustomEvent(params: TrackEventParams): Promise<void> {
    await this.saveEvent(params);
  }

  private async saveEvent(params: TrackEventParams): Promise<string | null> {
    const { data, error } = await this.db
      .from("tracking_events")
      .insert({
        tenant_id: params.tenantId,
        lead_id: params.leadId,
        bot_id: params.botId,
        event_type: params.eventType,
        fbclid: params.fbclid ?? null,
        tid: params.tid ?? null,
        utm_params: params.utmParams ?? {},
        event_data: params.eventData ?? {},
        sent_to_facebook: false,
        sent_to_utmify: false,
      })
      .select("id")
      .single();

    if (error) {
      console.error(`Failed to save tracking event: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
  }
}
