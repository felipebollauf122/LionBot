import { describe, it, expect, vi, beforeEach } from "vitest";
import { TiktokEvents } from "../../src/services/tiktok-events.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("TiktokEvents", () => {
  let events: TiktokEvents;

  beforeEach(() => {
    vi.clearAllMocks();
    events = new TiktokEvents("pixel_123", "access_token_abc");
  });

  it("should send a CompletePayment event to TikTok Events API", async () => {
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
    expect(body.data[0].event).toBe("CompletePayment");
    expect(body.data[0].event_time).toBe(1700000000);
    expect(body.data[0].event_id).toBe("evt_123");
    expect(body.data[0].properties.value).toBe(97.0);
    expect(body.data[0].properties.currency).toBe("BRL");
    expect(body.data[0].user.ttclid).toBe("ttclid_abc");
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

  it("should hash email/phone/external_id and leave ttclid/ttp/ip/user_agent raw", async () => {
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
    // hashed (sha256 hex = 64 chars), never plaintext
    expect(user.email).not.toBe("test@example.com");
    expect(user.email).toMatch(/^[a-f0-9]{64}$/);
    expect(user.phone_number).toMatch(/^[a-f0-9]{64}$/);
    expect(user.external_id[0]).toMatch(/^[a-f0-9]{64}$/);
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

  it("should refuse to send CompletePayment with invalid value", async () => {
    await events.sendCompletePaymentEvent({
      eventTime: 1700000000,
      userData: {},
      value: 0,
      currency: "BRL",
      eventId: "evt_zero",
    });

    expect(mockFetch).not.toHaveBeenCalled();
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
});
