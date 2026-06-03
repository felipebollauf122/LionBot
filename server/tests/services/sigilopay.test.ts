import { describe, it, expect, vi, beforeEach } from "vitest";
import { SigiloPay } from "../../src/services/sigilopay.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Headers stub que imita o que o código de produção consome no caminho de
// erro: response.headers.get("server") / get("cf-ray").
function makeHeaders(map: Record<string, string> = {}): Pick<Headers, "get"> {
  return {
    get: (name: string) => map[name.toLowerCase()] ?? null,
  };
}

describe("SigiloPay", () => {
  let service: SigiloPay;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SigiloPay("pub_test_123", "sec_test_456");
  });

  it("should create a Pix payment", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: makeHeaders(),
      json: async () => ({
        transactionId: "clwuwmn4i0007emp9lgn66u1h",
        status: "OK",
        order: {
          id: "order_abc123",
          url: "https://app.poseidonpay.site/order/order_abc123",
        },
        pix: {
          code: "00020101021126530014BR.GOV.BCB.PIX...",
          base64: "data:image/png;base64,iVBOR...",
          image: "https://api.gateway.com/pix/qr/...",
        },
      }),
      text: async () =>
        JSON.stringify({
          transactionId: "clwuwmn4i0007emp9lgn66u1h",
          status: "OK",
        }),
    });

    const result = await service.createPixPayment({
      identifier: "eaglebot_lead123_1234567890",
      amount: 97.0,
      clientName: "João Silva",
      clientEmail: "joao@gmail.com",
      clientPhone: "(11) 99999-9999",
      clientDocument: "123.456.789-00",
      products: [
        { id: "prod-1", name: "Curso de Marketing", quantity: 1, price: 97.0 },
      ],
      callbackUrl: "https://bot.example.com/webhook/payment",
    });

    expect(result).toEqual({
      transactionId: "clwuwmn4i0007emp9lgn66u1h",
      status: "OK",
      pixCode: "00020101021126530014BR.GOV.BCB.PIX...",
      pixImage: "https://api.gateway.com/pix/qr/...",
      orderId: "order_abc123",
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://app.poseidonpay.site/api/v1/gateway/pix/receive",
    );
    expect(options.method).toBe("POST");
    expect(options.headers["x-public-key"]).toBe("pub_test_123");
    expect(options.headers["x-secret-key"]).toBe("sec_test_456");

    const body = JSON.parse(options.body);
    expect(body.identifier).toBe("eaglebot_lead123_1234567890");
    expect(body.amount).toBe(97.0);
    expect(body.client.name).toBe("João Silva");
    expect(body.client.email).toBe("joao@gmail.com");
    expect(body.client.phone).toBe("(11) 99999-9999");
    expect(body.client.document).toBe("123.456.789-00");
  });

  it("should throw when keys are not configured", async () => {
    const emptyService = new SigiloPay("", "");
    await expect(
      emptyService.createPixPayment({
        identifier: "test_123",
        amount: 97.0,
        clientName: "João",
        clientEmail: "joao@gmail.com",
        clientPhone: "(11) 99999-9999",
        clientDocument: "123.456.789-00",
        callbackUrl: "https://example.com/webhook",
      }),
    ).rejects.toThrow(/não configuradas/);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should throw on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: makeHeaders({ server: "nginx", "cf-ray": "abc123" }),
      json: async () => ({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        message: "O valor fornecido para o campo 'amount' é inválido.",
      }),
      text: async () =>
        JSON.stringify({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          message: "O valor fornecido para o campo 'amount' é inválido.",
        }),
    });

    await expect(
      service.createPixPayment({
        identifier: "test_456",
        amount: -20,
        clientName: "João",
        clientEmail: "joao@gmail.com",
        clientPhone: "(11) 99999-9999",
        clientDocument: "123.456.789-00",
        callbackUrl: "https://example.com/webhook",
      }),
    ).rejects.toThrow(
      /Poseidon Pay API erro \(400\): O valor fornecido para o campo 'amount' é inválido\./,
    );
  });
});
