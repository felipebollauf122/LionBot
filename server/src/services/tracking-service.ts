import type { SupabaseClient } from "@supabase/supabase-js";
import type { FacebookCapi } from "./facebook-capi.js";
import type { TiktokEvents } from "./tiktok-events.js";
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
  /** Já enviado ao Facebook antes (dedup no caller) — não reenvia Purchase. */
  skipFacebook?: boolean;
  /** Já enviado ao TikTok antes (dedup no caller) — não reenvia CompletePayment. */
  skipTiktok?: boolean;
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
  /** id da transaction recém-criada (payment-button.ts) — usado no event_id
   *  pra não colidir entre Pix repetidos do mesmo lead/produto (ex: timeout
   *  de 15min é comum). Opcional só como defesa pro caso raro do insert de
   *  transaction ter falhado antes desta chamada. */
  transactionId?: string;
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
  /** ttclid capturado na tracking page (query param), se existir (#TikTok) */
  ttclid?: string;
  /** cookie _ttp capturado na tracking page, se existir (#TikTok) */
  ttp?: string;
}

/**
 * Look up the _fbp, _fbc real, click timestamp, IP, UA, accept-language,
 * referer, ttclid e ttp salvos no page_view. Tudo isso vai pro user_data do
 * CAPI (Facebook e TikTok) pra maximizar o match quality.
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
    ttclid: typeof ed.ttclid === "string" ? ed.ttclid : undefined,
    ttp: typeof ed.ttp === "string" ? ed.ttp : undefined,
  };
}

/**
 * external_ids — array com múltiplos formatos do mesmo usuário.
 * Cada string é hasheada SHA-256 pelo CAPI (Facebook e TikTok, cada um com
 * seu próprio hash()). Mais IDs = mais chance do índice encontrar match.
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
  // CPF como external_id extra (mais vetores de match) (#10)
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

/** Build user data for TikTok from lead info + click context */
function buildTiktokUserData(lead: LeadInfo, ctx: ClickContext) {
  return {
    externalIds: buildExternalIds(lead),
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    ttclid: ctx.ttclid || undefined,
    ttp: ctx.ttp || undefined,
    clientIp: ctx.clientIp,
    clientUserAgent: ctx.userAgent,
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
    private tiktokEvents: TiktokEvents,
  ) {}

  /**
   * Purchase — fires when SigiloPay confirms payment (status OK).
   * Sends: DB event + Facebook Purchase + TikTok CompletePayment + Utmify
   * paid order.
   *
   * This is the ONLY Facebook CAPI event fired by the platform — all user
   * data (email, phone, CPF, fbc com timestamp real de clique, fbp) é
   * anexado aqui pra maximizar Event Match Quality. TikTok (sem o mesmo
   * histórico de regressão de entrega) dispara CompletePayment aqui e nos
   * outros 3 eventos do funil (ver trackLead/trackViewOffer/trackCheckout).
   *
   * Facebook e TikTok são independentes: params.skipFacebook/skipTiktok
   * deixam o caller pular UMA rede que já confirmou entrega antes (guard de
   * dedup por transactionId) sem impedir o reenvio da OUTRA rede que ainda
   * não confirmou. O retorno { fbSent, tiktokSent } deixa o caller persistir
   * cada flag de dedup separadamente.
   */
  async trackPurchase(params: TrackPurchaseParams): Promise<{ fbSent: boolean; tiktokSent: boolean }> {
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

    // Load fbp + real click timestamp + IP/UA/sourceUrl/ttclid/ttp from the
    // original page_view
    const clickCtx = await loadClickContext(this.db, lead.tid);

    // Build structured contents array — Meta e TikTok preferem isso a
    // content_ids plano. ATENÇÃO: shapes DIFERENTES por rede (id/item_price
    // no Facebook vs content_id/price na TikTok) — nunca reusar o mesmo
    // array pras duas (era o bug: o array do Facebook ia inteiro pro
    // TikTok, que descartava tudo exceto quantity).
    const fbContents = params.productId
      ? [{ id: params.productId, quantity: 1, item_price: amountInCurrency }]
      : undefined;
    const ttContents = params.productId
      ? [{ content_id: params.productId, content_type: "product", content_name: params.productName, price: amountInCurrency, quantity: 1 }]
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
    // skipFacebook/skipTiktok: o caller já viu (via flag persistida na
    // transação) que essa rede específica já recebeu o Purchase pra essa
    // transactionId — não reenvia (evita duplicata que derruba EMQ). As
    // duas redes são independentes: uma pode já ter sido enviada com
    // sucesso enquanto a outra falhou/nunca foi configurada, então cada
    // uma tem seu próprio skip em vez de um guard único pras duas (#tiktok-dedup).
    const fbSent = params.skipFacebook
      ? false
      : await this.facebookCapi.sendPurchaseEvent({
          eventTime,
          eventId,
          userData,
          value: amountInCurrency,
          currency: params.currency,
          contentIds: params.productId ? [params.productId] : undefined,
          contentName: params.productName,
          contents: fbContents,
          numItems: 1,
          sourceUrl: clickCtx.sourceUrl,
          orderId: params.transactionId,
        });

    // TikTok CAPI — CompletePayment. Sempre dispara quando não já enviado
    // (só isConfigured() internamente) — não é o Facebook, não tem o mesmo
    // histórico de regressão de entrega com eventos de funil.
    const tiktokSent = params.skipTiktok
      ? false
      : await this.tiktokEvents.sendCompletePaymentEvent({
          eventTime,
          eventId,
          userData: buildTiktokUserData(leadWithDoc, clickCtx),
          value: amountInCurrency,
          currency: params.currency,
          contentIds: params.productId ? [params.productId] : undefined,
          contentName: params.productName,
          contents: ttContents,
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
        .update({ sent_to_facebook: fbSent, sent_to_utmify: utmifySent, sent_to_tiktok: tiktokSent })
        .eq("id", dbEventId);
    }
    return { fbSent, tiktokSent };
  }

  /**
   * Contexto "forte" = veio do anúncio (passou pela tracking page) com os
   * identificadores de maior peso pro Meta: fbp + fbc + IP + UA. Esse gate
   * é usado SÓ pro Facebook — o TikTok não tem essa restrição (ver
   * FUNNEL_CAPI_ENABLED abaixo).
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
   *
   * IMPORTANTE: esse gate é uma decisão de negócio ESPECÍFICA do Facebook
   * (a regressão observada foi na entrega/otimização de anúncios do
   * Facebook). NÃO se aplica ao TikTok — os métodos abaixo disparam os 4
   * eventos do funil pro TikTok incondicionalmente (só isConfigured()
   * internamente).
   */
  private static FUNNEL_CAPI_ENABLED = false;

  /**
   * InitiateCheckout — fires when Pix code is generated.
   * Sempre grava no DB. CAPI do Facebook só com contexto forte (#2) e com
   * FUNNEL_CAPI_ENABLED; TikTok InitiateCheckout dispara sempre.
   */
  async trackCheckout(params: TrackCheckoutParams): Promise<void> {
    const { lead } = params;
    const dbEventId = await this.saveEvent({
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

    const ctx = await loadClickContext(this.db, lead.tid);

    // transactionId no event_id (#B6): sem ele, um 2º Pix do mesmo
    // lead+produto (comum — timeout padrão é 15min) reusa o MESMO event_id
    // do 1º, e tanto Meta quanto TikTok deduplicam e descartam o InitiateCheckout
    // legítimo do reenvio. Fallback pro formato antigo só se a transaction
    // não tiver sido gravada (defesa, não deveria acontecer no fluxo normal).
    const checkoutEventId = params.transactionId
      ? `checkout_${params.transactionId}`
      : `checkout_${params.leadId}_${params.productId ?? "x"}`;

    let fbSent = false;
    if (TrackingService.FUNNEL_CAPI_ENABLED && this.hasStrongContext(ctx)) {
      fbSent = await this.facebookCapi
        .sendInitiateCheckoutEvent({
          eventTime: Math.floor(Date.now() / 1000),
          eventId: checkoutEventId,
          userData: buildFbUserData(lead, ctx),
          value: params.amount / 100,
          currency: params.currency,
          contentIds: params.productId ? [params.productId] : undefined,
          contentName: params.productName,
        })
        .catch((e) => {
          console.error("[tracking] InitiateCheckout CAPI falhou:", e);
          return false;
        });
    }

    const tiktokSent = await this.tiktokEvents.sendInitiateCheckoutEvent({
      eventTime: Math.floor(Date.now() / 1000),
      eventId: checkoutEventId,
      userData: buildTiktokUserData(lead, ctx),
      value: params.amount / 100,
      currency: params.currency,
      contentIds: params.productId ? [params.productId] : undefined,
      contentName: params.productName,
      sourceUrl: ctx.sourceUrl,
    });

    if (dbEventId) {
      await this.db
        .from("tracking_events")
        .update({ sent_to_facebook: fbSent, sent_to_tiktok: tiktokSent })
        .eq("id", dbEventId);
    }
  }

  /**
   * Lead — fires when a new lead enters the bot via tracking link.
   * Sempre grava no DB (o /start no bot nunca muda). CAPI do Facebook só
   * com contexto forte (#2) e FUNNEL_CAPI_ENABLED; TikTok Contact dispara
   * sempre.
   */
  async trackLead(params: TrackLeadParams): Promise<void> {
    const { lead } = params;
    const dbEventId = await this.saveEvent({
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

    const ctx = await loadClickContext(this.db, lead.tid);

    let fbSent = false;
    if (TrackingService.FUNNEL_CAPI_ENABLED && this.hasStrongContext(ctx)) {
      fbSent = await this.facebookCapi
        .sendLeadEvent({
          eventTime: Math.floor(Date.now() / 1000),
          eventId: `lead_${params.leadId}`,
          userData: buildFbUserData(lead, ctx),
        })
        .catch((e) => {
          console.error("[tracking] Lead CAPI falhou:", e);
          return false;
        });
    }

    const tiktokSent = await this.tiktokEvents.sendContactEvent({
      eventTime: Math.floor(Date.now() / 1000),
      eventId: `lead_${params.leadId}`,
      userData: buildTiktokUserData(lead, ctx),
      sourceUrl: ctx.sourceUrl,
    });

    if (dbEventId) {
      await this.db
        .from("tracking_events")
        .update({ sent_to_facebook: fbSent, sent_to_tiktok: tiktokSent })
        .eq("id", dbEventId);
    }
  }

  /**
   * ViewContent — fires when a lead sees the offer (view_offer event).
   * Sempre grava no DB. CAPI do Facebook só com contexto forte (#2) e
   * FUNNEL_CAPI_ENABLED; TikTok ViewContent dispara sempre.
   */
  async trackViewOffer(params: TrackViewOfferParams): Promise<void> {
    const { lead } = params;
    const dbEventId = await this.saveEvent({
      tenantId: params.tenantId,
      leadId: params.leadId,
      botId: params.botId,
      eventType: "view_offer",
      fbclid: lead.fbclid,
      tid: lead.tid,
      utmParams: buildUtmRecord(lead),
    });

    const ctx = await loadClickContext(this.db, lead.tid);

    // dbEventId no event_id (#M3): trackViewOffer roda em TODA execução de
    // nó de pagamento (oferta principal, upsell, downsell, cada disparo de
    // remarketing) pro MESMO lead. Sem um componente único por ocorrência,
    // `viewcontent_${leadId}` colide entre elas — a janela de dedup de 48h
    // da TikTok/Meta descarta as ofertas seguintes como duplicata do
    // ViewContent da primeira. O id do próprio evento salvo em
    // tracking_events já é único por ocorrência.
    //
    // NÃO é estável entre RETRIES da mesma ocorrência: dbEventId vem de um
    // INSERT incondicional feito nesta mesma chamada (saveEvent, sem
    // constraint única além da PK), então uma reexecução exata do mesmo nó
    // (ex: redelivery de update do Telegram — não há guard de update_id em
    // webhook/telegram.ts) gera um dbEventId novo e, com ele, um event_id
    // novo — a TikTok/Meta não têm como reconhecer como duplicata. Corrigir
    // isso de verdade exigiria uma chave de idempotência upstream (ex:
    // update_id do Telegram) que este código não tem hoje.
    const viewContentEventId = dbEventId ? `viewcontent_${dbEventId}` : `viewcontent_${params.leadId}`;

    let fbSent = false;
    if (TrackingService.FUNNEL_CAPI_ENABLED && this.hasStrongContext(ctx)) {
      fbSent = await this.facebookCapi
        .sendViewContentEvent({
          eventTime: Math.floor(Date.now() / 1000),
          eventId: viewContentEventId,
          userData: buildFbUserData(lead, ctx),
          contentName: params.contentName,
        })
        .catch((e) => {
          console.error("[tracking] ViewContent CAPI falhou:", e);
          return false;
        });
    }

    const tiktokSent = await this.tiktokEvents.sendViewContentEvent({
      eventTime: Math.floor(Date.now() / 1000),
      eventId: viewContentEventId,
      userData: buildTiktokUserData(lead, ctx),
      contentName: params.contentName,
      sourceUrl: ctx.sourceUrl,
    });

    if (dbEventId) {
      await this.db
        .from("tracking_events")
        .update({ sent_to_facebook: fbSent, sent_to_tiktok: tiktokSent })
        .eq("id", dbEventId);
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
        sent_to_tiktok: false,
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
