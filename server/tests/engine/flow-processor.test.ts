import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the queue module to avoid pulling in config (env vars), BullMQ and a
// real Redis connection at import time. The flow-processor → payment-button
// node → queue.js chain would otherwise fail to load under the test env.
vi.mock("../../src/queue.js", () => ({
  addPaymentTimeoutJob: vi.fn(),
  addDelayedJob: vi.fn(),
}));

import { FlowProcessor } from "../../src/engine/flow-processor.js";

const mockTelegram = {
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
};

const mockLeadService = {
  findOrCreateLead: vi.fn(),
  updatePosition: vi.fn(),
  updateState: vi.fn(),
  updatePositionAndState: vi.fn(),
  getById: vi.fn(),
};

const mockDb = {
  from: vi.fn(),
};

const mockQueue = {
  addDelayedJob: vi.fn(),
};

function makeFlow() {
  return {
    id: "flow-1",
    tenant_id: "tenant-1",
    bot_id: "bot-1",
    name: "Welcome Flow",
    trigger_type: "command",
    trigger_value: "/start",
    flow_data: {
      nodes: [
        { id: "trigger-1", type: "trigger", data: { trigger: "command", command: "/start" }, position: { x: 0, y: 0 } },
        { id: "text-1", type: "text", data: { text: "Welcome {{first_name}}!" }, position: { x: 0, y: 100 } },
        { id: "text-2", type: "text", data: { text: "How can I help?" }, position: { x: 0, y: 200 } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "text-1" },
        { id: "e2", source: "text-1", target: "text-2" },
      ],
    },
    is_active: true,
    version: 1,
    created_at: "",
    updated_at: "",
  };
}

function makeLead() {
  return {
    id: "lead-1",
    tenant_id: "tenant-1",
    bot_id: "bot-1",
    telegram_user_id: 12345,
    first_name: "João",
    last_name: null,
    username: "joao",
    tid: null, fbclid: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    current_flow_id: null,
    current_node_id: null,
    active_flow_name: null,
    state: {},
    created_at: "", updated_at: "",
  };
}

describe("FlowProcessor", () => {
  let processor: FlowProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new FlowProcessor(
      mockDb as any,
      mockLeadService as any,
      mockQueue as any,
    );
  });

  it("should execute a simple trigger → text → text flow", async () => {
    const flow = makeFlow();
    const lead = makeLead();

    await processor.executeFlow(flow as any, lead, mockTelegram as any, 12345);

    expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockTelegram.sendMessage).toHaveBeenNthCalledWith(1, {
      chatId: 12345,
      text: "Welcome João!",
    });
    expect(mockTelegram.sendMessage).toHaveBeenNthCalledWith(2, {
      chatId: 12345,
      text: "How can I help?",
    });

    expect(mockLeadService.updatePosition).toHaveBeenCalledWith("lead-1", null, null);
  });

  it("should stop at 'wait' nodes (input, button)", async () => {
    const flow = makeFlow();
    flow.flow_data.nodes[2] = {
      id: "input-1", type: "input",
      data: { prompt: "Qual seu email?", variable: "email" },
      position: { x: 0, y: 200 },
    };
    flow.flow_data.edges[1] = { id: "e2", source: "text-1", target: "input-1" };

    const lead = makeLead();

    await processor.executeFlow(flow as any, lead, mockTelegram as any, 12345);

    expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockLeadService.updatePosition).toHaveBeenCalledWith("lead-1", "flow-1", "input-1");
  });

  it("should schedule delayed execution for delay nodes", async () => {
    const flow = makeFlow();
    flow.flow_data.nodes.splice(1, 0, {
      id: "delay-1", type: "delay",
      data: { amount: 30, unit: "seconds" },
      position: { x: 0, y: 50 },
    });
    flow.flow_data.edges = [
      { id: "e1", source: "trigger-1", target: "delay-1" },
      { id: "e2", source: "delay-1", target: "text-1" },
      { id: "e3", source: "text-1", target: "text-2" },
    ];

    const lead = makeLead();

    await processor.executeFlow(flow as any, lead, mockTelegram as any, 12345);

    expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    expect(mockQueue.addDelayedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: "lead-1",
        flowId: "flow-1",
        nodeId: "text-1",
        botId: "bot-1",
      }),
      30
    );
  });
});
