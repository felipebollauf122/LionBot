import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleButtonNode } from "../../../src/engine/nodes/button.js";
import type { NodeContext } from "../../../src/engine/types.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeContext(buttons: unknown[]): NodeContext {
  return {
    node: {
      id: "btn-1",
      type: "button",
      data: { text: "Escolha uma opção:", buttons },
      position: { x: 0, y: 0 },
    },
    lead: {
      id: "lead-1", tenant_id: "t-1", bot_id: "b-1", telegram_user_id: 123,
      first_name: "João", last_name: null, username: null, tid: null, fbclid: null,
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
      current_flow_id: "f-1", current_node_id: "btn-1", active_flow_name: null, state: {},
      created_at: "", updated_at: "",
    },
    edges: [],
    telegram: { sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }) } as any,
    chatId: 123,
  };
}

/** Espera as promises de tracking (fire-and-forget) resolverem antes de
 *  inspecionar mockFetch — handleButtonNode retorna sem esperar por elas. */
function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Mock mínimo de SupabaseClient: bots → botConfig, products → lista,
 *  qualquer outra tabela (tracking_events, usada pelo TrackingService) →
 *  chain genérico que sempre "funciona" sem dado nenhum interessante. */
function makeDbMock(opts: {
  botConfig: Record<string, unknown> | null;
  products?: Array<{ id: string; name: string; ghost_name: string | null }>;
}) {
  const products = opts.products ?? [];
  return {
    from: vi.fn((table: string) => {
      if (table === "bots") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: opts.botConfig }),
        };
      }
      if (table === "products") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: products }),
        };
      }
      // tracking_events: saveEvent (insert→select→single) e loadClickContext
      // (select→eq→eq→order→limit→maybeSingle) e o update final dos flags.
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: "evt-1" }, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  } as any;
}

describe("handleButtonNode", () => {
  it("routes 'callback' and 'go_to_node' actions via nodeId:value (unchanged)", async () => {
    const ctx = makeContext([
      { text: "A", action: "callback", value: "val-a" },
      { text: "B", action: "go_to_node", value: "node-id-b" },
    ]);
    await handleButtonNode(ctx);
    const call = (ctx.telegram.sendMessage as any).mock.calls[0][0];
    expect(call.replyMarkup.inline_keyboard).toEqual([
      [{ text: "A", callback_data: "btn-1:val-a" }],
      [{ text: "B", callback_data: "btn-1:node-id-b" }],
    ]);
  });

  it("opens a URL directly for 'open_url', no callback_data", async () => {
    const ctx = makeContext([{ text: "Site", action: "open_url", value: "https://example.com" }]);
    await handleButtonNode(ctx);
    const call = (ctx.telegram.sendMessage as any).mock.calls[0][0];
    expect(call.replyMarkup.inline_keyboard).toEqual([[{ text: "Site", url: "https://example.com" }]]);
  });

  it("routes 'payment' action via nodeId:btnId, never exposing product_id or value", async () => {
    const ctx = makeContext([
      { id: "btn_0", text: "Comprar", action: "payment", value: "", product_id: "prod-secret-123" },
    ]);
    await handleButtonNode(ctx);
    const call = (ctx.telegram.sendMessage as any).mock.calls[0][0];
    expect(call.replyMarkup.inline_keyboard).toEqual([[{ text: "Comprar", callback_data: "btn-1:btn_0" }]]);
  });

  it("falls back to a positional id for a legacy payment button with no stable id", async () => {
    const ctx = makeContext([
      { text: "Legado", action: "callback", value: "x" },
      { text: "Comprar", action: "payment", value: "", product_id: "prod-1" },
    ]);
    await handleButtonNode(ctx);
    const call = (ctx.telegram.sendMessage as any).mock.calls[0][0];
    expect(call.replyMarkup.inline_keyboard[1]).toEqual([{ text: "Comprar", callback_data: "btn-1:btn_idx_1" }]);
  });

  // Antes desta correção, nenhum botão action:"payment" dentro de um nó
  // "button" comum disparava ViewContent — só o nó bundle dedicado
  // (payment-button.ts) disparava. Ver #view-content-inline-payment-button.
  describe("ViewContent tracking for inline payment buttons", () => {
    beforeEach(() => mockFetch.mockClear());

    it("fires a TikTok ViewContent per distinct product when a payment button + db are present", async () => {
      const db = makeDbMock({
        botConfig: {
          facebook_pixel_id: null,
          facebook_access_token: null,
          facebook_pixel_id_backup: null,
          facebook_access_token_backup: null,
          facebook_backup_enabled: false,
          tiktok_pixel_id: "pixel_1",
          tiktok_access_token: "token_1",
          utmify_api_key: null,
        },
        products: [{ id: "prod-1", name: "Nome real do produto", ghost_name: "Ghost" }],
      });
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) });

      const ctx = makeContext([
        { id: "btn_0", text: "Comprar", action: "payment", value: "", product_id: "prod-1" },
      ]);
      await handleButtonNode(ctx, db);
      await flushAsync();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.data[0].event).toBe("ViewContent");
      // Ghost, nunca o nome real — mesma regra de payment-button.ts.
      expect(body.data[0].properties.description).toBe("Ghost");
    });

    it("does NOT fire tracking when db is omitted (back-compat with existing callers)", async () => {
      const ctx = makeContext([
        { id: "btn_0", text: "Comprar", action: "payment", value: "", product_id: "prod-1" },
      ]);
      await handleButtonNode(ctx);
      await flushAsync();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does NOT fire tracking when no button has action:\"payment\"", async () => {
      const db = makeDbMock({ botConfig: { tiktok_pixel_id: "pixel_1", tiktok_access_token: "token_1" } });
      const ctx = makeContext([{ text: "A", action: "callback", value: "val-a" }]);
      await handleButtonNode(ctx, db);
      await flushAsync();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
