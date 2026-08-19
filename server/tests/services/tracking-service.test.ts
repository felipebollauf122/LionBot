import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackingService } from "../../src/services/tracking-service.js";

const mockSupabase = {
  from: vi.fn(),
};

const mockFacebookCapi = {
  sendPurchaseEvent: vi.fn().mockResolvedValue(true),
  sendLeadEvent: vi.fn().mockResolvedValue(true),
  sendViewContentEvent: vi.fn().mockResolvedValue(true),
  sendInitiateCheckoutEvent: vi.fn().mockResolvedValue(true),
};

const mockUtmify = {
  sendOrder: vi.fn().mockResolvedValue(true),
};

/**
 * Ao contrário do Facebook (Purchase-only, funil gated por
 * FUNNEL_CAPI_ENABLED), o TikTok dispara os 4 eventos do funil
 * incondicionalmente — só respeita isConfigured() internamente.
 */
const mockTiktokEvents = {
  sendCompletePaymentEvent: vi.fn().mockResolvedValue(true),
  sendContactEvent: vi.fn().mockResolvedValue(true),
  sendViewContentEvent: vi.fn().mockResolvedValue(true),
  sendInitiateCheckoutEvent: vi.fn().mockResolvedValue(true),
};

/** event_data com contexto FORTE (fbp + fbc + IP + UA) — necessário pro CAPI
 *  de funil (Lead/ViewContent/Checkout) disparar via loadClickContext. */
const STRONG_CLICK_CONTEXT = {
  fbp: "fb.1.1700000000.123456789",
  fbc: "fb.1.1700000000.fbclid_abc",
  click_time: 1700000000000,
  client_ip: "203.0.113.7",
  user_agent: "Mozilla/5.0 (Test)",
  source_url: "https://offer.example/page",
};

/**
 * O TrackingService faz duas formas de query distintas:
 *  - saveEvent:        .from().insert().select().single()        → { id }
 *  - loadClickContext: .from().select().eq().eq().order().limit().maybeSingle() → { event_data }
 *  - update flags:     .from().update().eq()                     → terminal
 *
 * Um único chain encadeável serve as três: single() devolve o id do evento
 * salvo, maybeSingle() devolve o page_view com o contexto de clique.
 */
function mockChain(opts?: {
  savedEventId?: string | null;
  saveError?: unknown;
  clickContext?: Record<string, unknown> | null;
}) {
  const savedEventId = opts?.savedEventId ?? "evt-1";
  const saveError = opts?.saveError ?? null;
  const clickContext = opts?.clickContext === undefined ? STRONG_CLICK_CONTEXT : opts.clickContext;

  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: savedEventId === null ? null : { id: savedEventId },
      error: saveError,
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: clickContext === null ? null : { event_data: clickContext },
      error: null,
    }),
  };
  mockSupabase.from.mockReturnValue(chain);
  return chain;
}

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    tid: "tid_xyz",
    fbclid: "fbclid_abc",
    firstName: "Joao",
    lastName: "Silva",
    email: "joao@example.com",
    phone: "11999998888",
    utmSource: "facebook",
    utmMedium: "cpc",
    utmCampaign: "launch",
    telegramUserId: 42,
    botId: "bot-1",
    ...overrides,
  };
}

describe("TrackingService", () => {
  let service: TrackingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TrackingService(
      mockSupabase as any,
      mockFacebookCapi as any,
      mockUtmify as any,
      mockTiktokEvents as any,
    );
  });

  it("should track a purchase event and dispatch to Facebook + TikTok + Utmify", async () => {
    mockChain({ savedEventId: "evt-1" });

    await service.trackPurchase({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      transactionId: "tx-1",
      amount: 9700, // cents
      currency: "BRL",
      lead: makeLead(),
      productId: "prod-1",
      productName: "Oferta",
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("tracking_events");
    expect(mockFacebookCapi.sendPurchaseEvent).toHaveBeenCalled();
    expect(mockTiktokEvents.sendCompletePaymentEvent).toHaveBeenCalled();
    expect(mockUtmify.sendOrder).toHaveBeenCalled();
  });

  // Regressão: Facebook e TikTok são redes independentes no dedup guard do
  // purchase-completer (transactions.sent_to_facebook / sent_to_tiktok).
  // skipFacebook/skipTiktok deixam o caller pular só a rede que já
  // confirmou, sem impedir o reenvio da outra que ainda não confirmou.
  it("should skip Facebook but still fire TikTok when skipFacebook=true", async () => {
    mockChain({ savedEventId: "evt-6" });

    const res = await service.trackPurchase({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      transactionId: "tx-2",
      amount: 9700,
      currency: "BRL",
      lead: makeLead(),
      productId: "prod-1",
      productName: "Oferta",
      skipFacebook: true,
    });

    expect(mockFacebookCapi.sendPurchaseEvent).not.toHaveBeenCalled();
    expect(mockTiktokEvents.sendCompletePaymentEvent).toHaveBeenCalled();
    expect(res.fbSent).toBe(false);
    expect(res.tiktokSent).toBe(true);
  });

  it("should skip TikTok but still fire Facebook when skipTiktok=true", async () => {
    mockChain({ savedEventId: "evt-7" });

    const res = await service.trackPurchase({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      transactionId: "tx-3",
      amount: 9700,
      currency: "BRL",
      lead: makeLead(),
      productId: "prod-1",
      productName: "Oferta",
      skipTiktok: true,
    });

    expect(mockFacebookCapi.sendPurchaseEvent).toHaveBeenCalled();
    expect(mockTiktokEvents.sendCompletePaymentEvent).not.toHaveBeenCalled();
    expect(res.fbSent).toBe(true);
    expect(res.tiktokSent).toBe(false);
  });

  // Purchase-only no CAPI do Facebook (revertido 2026-06-03): eventos de
  // funil gravam no DB mas NÃO disparam pro Facebook (FUNNEL_CAPI_ENABLED=
  // false). O TikTok NÃO tem esse gate — dispara sempre.
  it("should track a lead event (bot_start): saves to DB, fires TikTok Contact, but NOT Facebook CAPI", async () => {
    mockChain({ savedEventId: "evt-2" });

    await service.trackLead({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      lead: makeLead(),
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("tracking_events");
    expect(mockFacebookCapi.sendLeadEvent).not.toHaveBeenCalled();
    expect(mockTiktokEvents.sendContactEvent).toHaveBeenCalled();
  });

  it("should track a view_offer event: saves to DB, fires TikTok ViewContent, but NOT Facebook CAPI", async () => {
    mockChain({ savedEventId: "evt-3" });

    await service.trackViewOffer({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      lead: makeLead(),
      contentName: "Oferta principal",
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("tracking_events");
    expect(mockFacebookCapi.sendViewContentEvent).not.toHaveBeenCalled();
    expect(mockTiktokEvents.sendViewContentEvent).toHaveBeenCalled();
  });

  it("should track a checkout event: saves to DB, fires TikTok InitiateCheckout, but NOT Facebook CAPI", async () => {
    mockChain({ savedEventId: "evt-4" });

    await service.trackCheckout({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      amount: 9700,
      currency: "BRL",
      lead: makeLead(),
      productId: "prod-1",
      productName: "Oferta",
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("tracking_events");
    expect(mockFacebookCapi.sendInitiateCheckoutEvent).not.toHaveBeenCalled();
    expect(mockTiktokEvents.sendInitiateCheckoutEvent).toHaveBeenCalled();
  });

  it("should NOT fire Lead CAPI without strong click context (still saves to DB, still fires TikTok)", async () => {
    // Sem page_view salvo → loadClickContext devolve {} → contexto fraco.
    mockChain({ savedEventId: "evt-5", clickContext: null });

    await service.trackLead({
      tenantId: "t-1",
      leadId: "lead-1",
      botId: "bot-1",
      lead: makeLead(),
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("tracking_events");
    expect(mockFacebookCapi.sendLeadEvent).not.toHaveBeenCalled();
    // TikTok não tem gate de "contexto forte" — dispara mesmo sem fbp/fbc/IP/UA.
    expect(mockTiktokEvents.sendContactEvent).toHaveBeenCalled();
  });
});
