import { describe, it, expect, vi } from "vitest";

// Mock the queue module to avoid pulling in config (env vars), BullMQ and a
// real Redis connection at import time. The node-executor → payment-button
// node → queue.js chain would otherwise fail to load under the test env.
vi.mock("../../src/queue.js", () => ({
  addPaymentTimeoutJob: vi.fn(),
  addDelayedJob: vi.fn(),
}));

import { executeNode } from "../../src/engine/node-executor.js";
import type { NodeContext } from "../../src/engine/types.js";

function makeContext(type: string, data: Record<string, unknown> = {}): NodeContext {
  return {
    node: { id: "n-1", type: type as any, data, position: { x: 0, y: 0 } },
    lead: {
      id: "l-1", tenant_id: "t-1", bot_id: "b-1", telegram_user_id: 123,
      first_name: "Test", last_name: null, username: null, tid: null, fbclid: null,
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
      current_flow_id: "f-1", current_node_id: "n-1", active_flow_name: null, state: {},
      created_at: "", updated_at: "",
    },
    edges: [{ id: "e1", source: "n-1", target: "n-2" }],
    telegram: { sendMessage: vi.fn(), sendPhoto: vi.fn() } as any,
    chatId: 123,
  };
}

describe("executeNode", () => {
  it("should dispatch text node correctly", async () => {
    const ctx = makeContext("text", { text: "Hello" });
    const result = await executeNode(ctx);
    expect(ctx.telegram.sendMessage).toHaveBeenCalled();
    expect(result.nextNodeId).toBe("n-2");
  });

  it("should dispatch trigger node correctly", async () => {
    const ctx = makeContext("trigger", { trigger: "command", command: "/start" });
    const result = await executeNode(ctx);
    expect(result.nextNodeId).toBe("n-2");
  });

  it("should dispatch condition node correctly", async () => {
    const ctx = makeContext("condition", { field: "paid", operator: "equals", value: "true" });
    ctx.edges = [
      { id: "e-t", source: "n-1", target: "n-yes", sourceHandle: "true" },
      { id: "e-f", source: "n-1", target: "n-no", sourceHandle: "false" },
    ];
    ctx.lead.state = { paid: false };
    const result = await executeNode(ctx);
    expect(result.nextNodeId).toBe("n-no");
  });

  it("should return null for unknown node type", async () => {
    const ctx = makeContext("unknown_type");
    const result = await executeNode(ctx);
    expect(result.nextNodeId).toBeNull();
  });
});
