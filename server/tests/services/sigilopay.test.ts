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

  it("surfaces the 'details' field on generic validation errors instead of hiding it", async () => {
    // Reproduz o erro real relatado: a API devolve message genérica
    // ("Dados da requisição inválidos, verifique 'details' para mais
    // informações") mas o campo que ela mesma aponta como explicação nunca
    // chegava no throw — o admin via só "verifique 'details'" sem os
    // details. errorBody imita o formato de validação mais comum (array de
    // {path, message}, estilo Zod).
    const errorBody = {
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
      message: "Dados da requisição inválidos, verifique 'details' para mais informações",
      details: [
        { path: "client.document", message: "CPF inválido" },
        { path: "client.phone", message: "Telefone deve estar no formato E.164" },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: makeHeaders({ server: "nginx", "cf-ray": "abc123" }),
      json: async () => errorBody,
      text: async () => JSON.stringify(errorBody),
    });

    await expect(
      service.createPixPayment({
        identifier: "test_789",
        amount: 97.0,
        clientName: "João",
        clientEmail: "joao@gmail.com",
        clientPhone: "11999999999",
        clientDocument: "52998224725",
        callbackUrl: "https://example.com/webhook",
      }),
    ).rejects.toThrow(
      /Dados da requisição inválidos, verifique 'details' para mais informações — client\.document: CPF inválido; client\.phone: Telefone deve estar no formato E\.164/,
    );
  });

  it("joins an array-style 'path' (Zod-shaped details) with dots, not the default comma", async () => {
    // Bug real observado em produção: a Poseidon devolve `path` como array
    // (["client","email"]) — interpolar o array direto num template literal
    // chama Array.toString(), que junta com VÍRGULA por padrão, então a
    // mensagem de erro saía "client,email: Invalid email" em vez de
    // "client.email: Invalid email".
    const errorBody = {
      statusCode: 400,
      message: "Dados da requisição inválidos, verifique 'details' para mais informações",
      details: [{ path: ["client", "email"], message: "Invalid email" }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: makeHeaders({ server: "nginx", "cf-ray": "abc123" }),
      json: async () => errorBody,
      text: async () => JSON.stringify(errorBody),
    });

    await expect(
      service.createPixPayment({
        identifier: "test_email_path",
        amount: 97.0,
        clientName: "João",
        clientEmail: "joão@gmail.com",
        clientPhone: "11999999999",
        clientDocument: "52998224725",
        callbackUrl: "https://example.com/webhook",
      }),
    ).rejects.toThrow(
      /Dados da requisição inválidos, verifique 'details' para mais informações — client\.email: Invalid email/,
    );
  });

  it("falls back to the full error body when no recognizable details-like field exists", async () => {
    // Reproduz o caso relatado em produção: a API devolve exatamente
    // "verifique 'details' para mais informações" mas o body NÃO tem uma
    // chave "details" (nem nenhum dos outros nomes tentados) — só
    // statusCode/message. Sem fallback isso silenciosamente virava a MESMA
    // mensagem genérica de sempre, escondendo que o campo prometido nem veio.
    const errorBody = {
      statusCode: 400,
      message: "Dados da requisição inválidos, verifique 'details' para mais informações",
      extra: "algum campo com nome que a gente não previu",
    };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: makeHeaders({ server: "nginx", "cf-ray": "abc123" }),
      json: async () => errorBody,
      text: async () => JSON.stringify(errorBody),
    });

    await expect(
      service.createPixPayment({
        identifier: "test_999",
        amount: 97.0,
        clientName: "João",
        clientEmail: "joao@gmail.com",
        clientPhone: "11999999999",
        clientDocument: "52998224725",
        callbackUrl: "https://example.com/webhook",
      }),
    ).rejects.toThrow(
      /Dados da requisição inválidos, verifique 'details' para mais informações — \{"extra":"algum campo com nome que a gente não previu"\}/,
    );
  });
});
