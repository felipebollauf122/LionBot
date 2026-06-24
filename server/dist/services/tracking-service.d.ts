import type { SupabaseClient } from "@supabase/supabase-js";
import type { FacebookCapi } from "./facebook-capi.js";
import type { UtmifyService } from "./utmify.js";
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
    amount: number;
    currency: string;
    lead: LeadInfo;
    customerDocument?: string;
    productId?: string;
    productName?: string;
    paidAtIso?: string;
}
interface TrackCheckoutParams {
    tenantId: string;
    leadId: string;
    botId: string;
    amount: number;
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
export declare class TrackingService {
    private db;
    private facebookCapi;
    private utmify;
    constructor(db: SupabaseClient, facebookCapi: FacebookCapi, utmify: UtmifyService);
    /**
     * Purchase — fires when SigiloPay confirms payment (status OK).
     * Sends: DB event + Facebook Purchase + Utmify paid order.
     *
     * This is the ONLY Facebook CAPI event fired by the platform — all user
     * data (email, phone, CPF, fbc with real click timestamp, fbp) is attached
     * here to maximize Event Match Quality.
     */
    trackPurchase(params: TrackPurchaseParams): Promise<{
        fbSent: boolean;
    }>;
    /**
     * Contexto "forte" = veio do anúncio (passou pela tracking page) com os
     * identificadores de maior peso pro Meta: fbp + fbc + IP + UA.
     */
    private hasStrongContext;
    /**
     * Resolve estado/cidade do IP do page_view (via ip-api) e grava em
     * event_data.state/.city. Best-effort: silencia qualquer erro e pula se já
     * estiver enriquecido ou sem IP. Lê e regrava o page_view mais recente do tid.
     */
    private enrichGeo;
    /**
     * REVERTIDO 2026-06-03: o disparo de Lead/ViewContent/InitiateCheckout
     * pro Facebook (reativado na Onda 1 EMQ) coincidiu com o bot parar de
     * vender — a campanha estava otimizada pra Purchase e os eventos de
     * funil novos bagunçaram a otimização/entrega (mais lead, menos venda).
     * Voltamos pra estratégia Purchase-ONLY no CAPI, que era o estado que
     * vendia. Os eventos continuam gravando no DB (contadores do dashboard).
     * Pra religar e testar de novo no futuro, mude pra true.
     */
    private static FUNNEL_CAPI_ENABLED;
    /**
     * InitiateCheckout — fires when Pix code is generated.
     * Sempre grava no DB. Dispara CAPI só com contexto forte (#2).
     */
    trackCheckout(params: TrackCheckoutParams): Promise<void>;
    /**
     * Lead — fires when a new lead enters the bot via tracking link.
     * Sempre grava no DB (o /start no bot nunca muda). Dispara CAPI só com
     * contexto forte (#2) — Lead "pelado" sem dado de contato rebaixa EMQ.
     */
    trackLead(params: TrackLeadParams): Promise<void>;
    /**
     * ViewContent — fires when a lead sees the offer (view_offer event).
     * Sempre grava no DB. Dispara CAPI só com contexto forte (#2).
     */
    trackViewOffer(params: TrackViewOfferParams): Promise<void>;
    trackCustomEvent(params: TrackEventParams): Promise<void>;
    private saveEvent;
}
export {};
