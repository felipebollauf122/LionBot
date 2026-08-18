import { describe, it, expect, vi } from "vitest";
import { handleButtonNode } from "../../../src/engine/nodes/button.js";
import type { NodeContext } from "../../../src/engine/types.js";

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
});
