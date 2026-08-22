import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { TiktokEvents } from "../../src/services/tiktok-events.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

describe("TiktokEvents", () => {
  let events: TiktokEvents;

  beforeEach(() => {
    vi.clearAllMocks();
    events = new TiktokEvents("pixel_123", "access_token_abc");
  });

  it("should send a Purchase event to TikTok Events API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: "OK" }),
    });

    await events.sendCompletePaymentEvent({
      eventTime: 1700000000,
      userData: { ttclid: "ttclid_abc" },
      value: 97.0,
      currency: "BRL",
      eventId: "evt_123",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect(options.method).toBe("POST");
    expect(options.headers["Access-Token"]).toBe("access_token_abc");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.event_source).toBe("web");
    expect(body.event_source_id).toBe("pixel_123");
    // Renomeado de "CompletePayment" pra "Purchase" no rollout de eventos
    // padrão da TikTok (ago/set 2025) — ver comentário em sendCompletePaymentEvent.
    expect(body.data[0].event).toBe("Purchase");
    expect(body.data[0].event_time).toBe(1700000000);
    expect(body.data[0].event_id).toBe("evt_123");
    expect(body.data[0].properties.value).toBe(97.0);
    expect(body.data[0].properties.currency).toBe("BRL");
    expect(body.data[0].user.ttclid).toBe("ttclid_abc");
    // sem test_event_code por padrão (TIKTOK_TEST_EVENT_CODE não setado)
    expect(body.test_event_code).toBeUndefined();
  });

  it("should send a Contact event", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: "OK" }),
    });

    await events.sendContactEvent({
      eventTime: 1700000000,
      userData: { ttclid: "ttclid_abc" },
      eventId: "evt_456",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.data[0].event).toBe("Contact");
  });

  // Regressão M1/M5: o teste antigo lia `user.phone_number` (o campo que o
  // código produzia) e confirmava que o código produz o próprio campo —
  // tautológico, não pegava nome de campo errado nem formato errado. Este
  // assere contra o valor REAL esperado (hash de "+5511999998888", E.164
  // completo com o "+") — se o campo voltar a se chamar phone_number, ou o
  // "+" sumir, o teste quebra por construção.
  it("should hash email/phone/external_id per TikTok's own field names and E.164-with-plus, and leave ttclid/ttp/ip/user_agent raw", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: "OK" }),
    });

    await events.sendContactEvent({
      eventTime: 1700000000,
      userData: {
        externalIds: ["lead-1"],
        email: "Test@Example.com",
        phone: "11999998888",
        ttclid: "raw_ttclid",
        ttp: "raw_ttp",
        clientIp: "203.0.113.7",
        clientUserAgent: "Mozilla/5.0",
      },
      eventId: "evt_789",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const user = body.data[0].user;
    // hashed contra o valor real — não só o shape (64 hex chars provaria
    // pouco: o hash de QUALQUER string errada também tem 64 hex chars)
    expect(user.email).toBe(sha256("test@example.com"));
    expect(user.phone).toBe(sha256("+5511999998888"));
    expect(user.phone_number).toBeUndefined(); // nome legado (Events API 1.0) — não deve existir
    expect(user.external_id[0]).toBe(sha256("lead-1"));
    // raw, not hashed
    expect(user.ttclid).toBe("raw_ttclid");
    expect(user.ttp).toBe("raw_ttp");
    expect(user.ip).toBe("203.0.113.7");
    expect(user.user_agent).toBe("Mozilla/5.0");
  });

  it("should skip sending if no pixel or token configured", async () => {
    const emptyEvents = new TiktokEvents("", "");

    await emptyEvents.sendCompletePaymentEvent({
      eventTime: 1700000000,
      userData: {},
      value: 97.0,
      currency: "BRL",
      eventId: "evt_999",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // #B14: configuração PARCIAL (só pixel OU só token) é sempre erro de
  // operador e precisa aparecer no log — diferente de ausência total (bot
  // sem TikTok, silencioso de propósito).
  it("should warn on partial config (pixel without token) but stay silent on full absence", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const partial = new TiktokEvents("pixel_only", "");
    await partial.sendContactEvent({ eventTime: 1700000000, userData: {}, eventId: "evt_partial" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("configuração parcial"));

    warnSpy.mockClear();
    const absent = new TiktokEvents("", "");
    await absent.sendContactEvent({ eventTime: 1700000000, userData: {}, eventId: "evt_absent" });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("should refuse to send Purchase with invalid value", async () => {
    await events.sendCompletePaymentEvent({
      eventTime: 1700000000,
      userData: {},
      value: 0,
      currency: "BRL",
      eventId: "evt_zero",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // sendInitiateCheckoutEvent não tinha essa guarda (só sendCompletePaymentEvent
  // tinha) — mesma regra de negócio nas duas (o valor é sempre preço de
  // produto, nunca 0/negativo por design).
  it("should refuse to send InitiateCheckout with invalid value", async () => {
    await events.sendInitiateCheckoutEvent({
      eventTime: 1700000000,
      userData: {},
      value: -5,
      currency: "BRL",
      eventId: "evt_checkout_neg",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // #M2: contents[] usa o shape PRÓPRIO da TikTok (content_id/price/quantity),
  // nunca o do Facebook (id/item_price) — e content_id/content_ids/description
  // em properties (#B1/#B4).
  it("should send contents[] in TikTok's own shape and content_id + content_ids + description in properties", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: "OK" }),
    });

    await events.sendCompletePaymentEvent({
      eventTime: 1700000000,
      userData: {},
      value: 97.0,
      currency: "BRL",
      eventId: "evt_contents",
      contentIds: ["prod-1"],
      contentName: "Oferta principal",
      contents: [{ content_id: "prod-1", content_type: "product", content_name: "Oferta principal", price: 97.0, quantity: 1 }],
      orderId: "tx-1",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const properties = body.data[0].properties;
    expect(properties.content_id).toBe("prod-1");
    expect(properties.content_ids).toEqual(["prod-1"]);
    expect(properties.description).toBe("Oferta principal");
    expect(properties.content_name).toBeUndefined(); // não é campo válido em properties (só dentro de contents[])
    expect(properties.contents).toEqual([
      { content_id: "prod-1", content_type: "product", content_name: "Oferta principal", price: 97.0, quantity: 1 },
    ]);
    expect(properties.order_id).toBe("tx-1");
  });

  it("should retry on 5xx and eventually succeed", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ code: 50000, message: "server error" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

    const ok = await events.sendContactEvent({
      eventTime: 1700000000,
      userData: {},
      eventId: "evt_retry",
    });

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // #B2: a Business API costuma responder HTTP 200 com o erro só no corpo
  // (code=40100 = throttle QPM/QPD, confirmado na doc oficial de rate
  // limits) — esse é o caso REAL de rate limit em produção, não um HTTP 429.
  // O critério antigo (só status HTTP) não pegava esse caso.
  it("should retry on HTTP 200 with code=40100 (logical rate limit) and eventually succeed", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 40100, message: "rate limited" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

    const ok = await events.sendContactEvent({
      eventTime: 1700000000,
      userData: {},
      eventId: "evt_ratelimit",
    });

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should NOT retry on a non-5xx/429 failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: 40002, message: "invalid access token" }),
    });

    const ok = await events.sendContactEvent({
      eventTime: 1700000000,
      userData: {},
      eventId: "evt_400",
    });

    expect(ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // #B15/#tiktok-test-event-per-bot: test_event_code agora é por INSTÂNCIA
  // (constructor), não process.env global — uma auditoria de 2026-08-21
  // encontrou que a env var global desviava a produção de TODOS os bots do
  // mesmo processo ao validar o pixel de só um deles.
  describe("test event code (per-instance, via constructor)", () => {
    it("should include test_event_code in the body when passed to the constructor", async () => {
      const testEvents = new TiktokEvents("pixel_123", "access_token_abc", "bot-1", "TEST12345");
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

      await testEvents.sendContactEvent({ eventTime: 1700000000, userData: {}, eventId: "evt_test_code" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.test_event_code).toBe("TEST12345");
    });

    it("should omit test_event_code when not passed to the constructor", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

      await events.sendContactEvent({ eventTime: 1700000000, userData: {}, eventId: "evt_no_test_code" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.test_event_code).toBeUndefined();
    });

    it("should NOT be affected by a leftover TIKTOK_TEST_EVENT_CODE env var (killed the global-env mechanism)", async () => {
      process.env.TIKTOK_TEST_EVENT_CODE = "LEFTOVER_ENV_VALUE";
      try {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });
        await events.sendContactEvent({ eventTime: 1700000000, userData: {}, eventId: "evt_env_ignored" });
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.test_event_code).toBeUndefined();
      } finally {
        delete process.env.TIKTOK_TEST_EVENT_CODE;
      }
    });
  });

  // sendViewContentEvent nunca era testado apesar de, segundo o comentário
  // em tracking-service.ts, ser o evento de maior volume do funil (dispara
  // "sempre" a cada visualização de oferta).
  describe("sendViewContentEvent", () => {
    it("should send a ViewContent event with contentName in properties (incl. quantity)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

      const ok = await events.sendViewContentEvent({
        eventTime: 1700000000,
        userData: { ttclid: "ttclid_abc" },
        eventId: "evt_view",
        contentName: "Oferta principal",
        sourceUrl: "https://offer.example/page",
      });

      expect(ok).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data[0].event).toBe("ViewContent");
      expect(body.data[0].event_id).toBe("evt_view");
      expect(body.data[0].properties).toEqual({
        content_type: "product",
        description: "Oferta principal",
        quantity: 1,
      });
      expect(body.data[0].page).toEqual({ url: "https://offer.example/page" });
    });

    it("should omit properties entirely when no contentName is given", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

      await events.sendViewContentEvent({
        eventTime: 1700000000,
        userData: {},
        eventId: "evt_view_no_name",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data[0].properties).toBeUndefined();
      expect(body.data[0].page).toBeUndefined();
    });
  });

  // sendInitiateCheckoutEvent só tinha teste do guard de valor inválido —
  // nenhuma asserção cobria o payload de sucesso.
  describe("sendInitiateCheckoutEvent (success payload)", () => {
    it("should send properties.value/currency/quantity + content_id/content_ids + page.url", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

      const ok = await events.sendInitiateCheckoutEvent({
        eventTime: 1700000000,
        userData: {},
        value: 47.5,
        currency: "brl",
        eventId: "evt_checkout_ok",
        contentIds: ["prod-2"],
        contentName: "Upsell",
        sourceUrl: "https://offer.example/checkout",
      });

      expect(ok).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data[0].event).toBe("InitiateCheckout");
      const properties = body.data[0].properties;
      expect(properties.value).toBe(47.5);
      expect(properties.currency).toBe("BRL");
      expect(properties.quantity).toBe(1);
      expect(properties.content_id).toBe("prod-2");
      expect(properties.content_ids).toEqual(["prod-2"]);
      expect(properties.description).toBe("Upsell");
      expect(body.data[0].page).toEqual({ url: "https://offer.example/checkout" });
    });
  });

  // properties.quantity também vale pro Purchase (#quantity-param) — a
  // TikTok documenta como recomendado ao lado de value/currency.
  it("should include properties.quantity=1 on Purchase", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

    await events.sendCompletePaymentEvent({
      eventTime: 1700000000,
      userData: {},
      value: 97.0,
      currency: "BRL",
      eventId: "evt_qty",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.data[0].properties.quantity).toBe(1);
  });

  // validatePhoneE164 tem 3 branches de rejeição sem cobertura — só o
  // caminho feliz era testado.
  describe("validatePhoneE164 rejection branches", () => {
    it("should reject and omit phone when digits are too short for E.164", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });
      await events.sendContactEvent({
        eventTime: 1700000000,
        userData: { phone: "123" },
        eventId: "evt_phone_short",
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data[0].user.phone).toBeUndefined();
    });

    it("should reject and omit phone that looks like a placeholder (repeated digit / fake 9-block)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });
      await events.sendContactEvent({
        eventTime: 1700000000,
        userData: { phone: "11999999999" },
        eventId: "evt_phone_placeholder",
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data[0].user.phone).toBeUndefined();
    });
  });
});
