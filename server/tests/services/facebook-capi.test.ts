import { describe, it, expect, vi, beforeEach } from "vitest";
import { FacebookCapi } from "../../src/services/facebook-capi.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("FacebookCapi", () => {
  let capi: FacebookCapi;

  beforeEach(() => {
    vi.clearAllMocks();
    capi = new FacebookCapi("pixel_123", "access_token_abc");
  });

  it("should send a Purchase event to Facebook CAPI", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events_received: 1 }),
    });

    await capi.sendPurchaseEvent({
      eventTime: 1700000000,
      userData: { fbc: "fb.1.123.fbclid_abc" },
      value: 97.0,
      currency: "BRL",
      eventId: "evt_123",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/pixel_123/events");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.access_token).toBe("access_token_abc");
    expect(body.data[0].event_name).toBe("Purchase");
    expect(body.data[0].custom_data.value).toBe(97.0);
    expect(body.data[0].custom_data.currency).toBe("BRL");
    expect(body.data[0].user_data.fbc).toBe("fb.1.123.fbclid_abc");
  });

  it("should send a Lead event", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events_received: 1 }),
    });

    await capi.sendLeadEvent({
      eventTime: 1700000000,
      userData: { fbc: "fb.1.123.fbclid_abc" },
      eventId: "evt_456",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.data[0].event_name).toBe("Lead");
  });

  it("should skip sending if no pixel or token configured", async () => {
    const emptyCapi = new FacebookCapi("", "");

    await emptyCapi.sendPurchaseEvent({
      eventTime: 1700000000,
      userData: { fbc: "" },
      value: 97.0,
      currency: "BRL",
      eventId: "evt_789",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
