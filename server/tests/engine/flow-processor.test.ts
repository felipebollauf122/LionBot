import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the queue module to avoid pulling in config (env vars), BullMQ and a
// real Redis connection at import time. The flow-processor → payment-button
// node → queue.js chain would otherwise fail to load under the test env.
vi.mock("../../src/queue.js", () => ({
  addPaymentTimeoutJob: vi.fn(),
  addDelayedJob: vi.fn(),
}));

// Mocked so handleCallbackQuery tests exercise routing/interception only —
// the actual PIX-generation logic inside payment-button.ts is unrelated to
// what's under test here (and has its own, much heavier, DB-mocking cost).
const mockHandleProductPaymentCallback = vi.fn();
vi.mock("../../src/engine/nodes/payment-button.js", () => ({
  handleProductPaymentCallback: (...args: unknown[]) => mockHandleProductPaymentCallback(...args),
  handlePaymentBundleNode: vi.fn(),
}));

import { FlowProcessor } from "../../src/engine/flow-processor.js";
import { flowByIdCache } from "../../src/cache.js";

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
    flowByIdCache.clear();
    processor = new FlowProcessor(
      mockDb as any,
      mockLeadService as any,
      mockQueue as any,
      { gateway: {} as any, gatewayKind: "sigilopay", baseWebhookUrl: "https://example.com" },
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

  describe("handleCallbackQuery", () => {
    function makePaymentFlow() {
      const flow = {
        id: "flow-pay",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        name: "Payment Flow",
        trigger_type: "command",
        trigger_value: "/start",
        flow_data: {
          nodes: [
            {
              id: "button-1",
              type: "button",
              data: {
                text: "Escolha:",
                buttons: [
                  { id: "btn_0", text: "Comprar", action: "payment", value: "", product_id: "prod-1" },
                  { text: "Outro", action: "go_to_node", value: "text-2" },
                ],
              },
              position: { x: 0, y: 0 },
            },
            { id: "text-2", type: "text", data: { text: "Você foi pro outro caminho" }, position: { x: 0, y: 100 } },
            { id: "paid-node", type: "text", data: { text: "Pagamento confirmado" }, position: { x: 0, y: 200 } },
            { id: "notpaid-node", type: "text", data: { text: "Pagamento não confirmado" }, position: { x: 100, y: 200 } },
          ],
          edges: [
            // "paid:btn_0" listed FIRST on purpose — before the edges[0]
            // fallback fix, this would be exactly what a non-matching
            // button click silently fell back to (see the 3rd test below).
            { id: "e-paid", source: "button-1", target: "paid-node", sourceHandle: "paid:btn_0" },
            { id: "e-notpaid", source: "button-1", target: "notpaid-node", sourceHandle: "not_paid:btn_0" },
            { id: "e-goto", source: "button-1", target: "text-2" },
          ],
        },
        is_active: true,
        version: 1,
        created_at: "",
        updated_at: "",
      };
      flowByIdCache.set(flow.id, flow as any);
      return flow;
    }

    function makeLeadOnFlow() {
      return { ...makeLead(), current_flow_id: "flow-pay", current_node_id: "button-1" };
    }

    it("still routes an ordinary go_to_node button by matching edge.target (unchanged)", async () => {
      makePaymentFlow();
      const lead = makeLeadOnFlow();

      await processor.handleCallbackQuery({ id: "bot-1", tenant_id: "tenant-1" }, lead, mockTelegram as any, 12345, "button-1:text-2");

      expect(mockTelegram.sendMessage).toHaveBeenCalledWith({ chatId: 12345, text: "Você foi pro outro caminho" });
      expect(mockHandleProductPaymentCallback).not.toHaveBeenCalled();
    });

    it("intercepts a payment-action button click and calls handleProductPaymentCallback with the live node + button id", async () => {
      makePaymentFlow();
      const lead = makeLeadOnFlow();
      mockHandleProductPaymentCallback.mockResolvedValueOnce({
        nextNodeId: "wait",
        stateUpdates: { pending_transaction_id: "tx-1", pending_payment_button_id: "btn_0" },
      });

      await processor.handleCallbackQuery({ id: "bot-1", tenant_id: "tenant-1" }, lead, mockTelegram as any, 12345, "button-1:btn_0");

      expect(mockHandleProductPaymentCallback).toHaveBeenCalledTimes(1);
      const args = mockHandleProductPaymentCallback.mock.calls[0];
      expect(args[0].node.id).toBe("button-1"); // live sourceNode, not a synthetic reconstruction
      expect(args[3]).toBe("https://example.com"); // baseWebhookUrl
      expect(args[4]).toBe("prod-1"); // product_id resolved server-side from the button config
      expect(args[5]).toBe("sigilopay");
      expect(args[6]).toBe("btn_0"); // paymentButtonId

      // Never falls through to standard edge resolution / executeFlow.
      expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
      expect(mockLeadService.updateState).toHaveBeenCalledWith(
        "lead-1",
        expect.objectContaining({ pending_transaction_id: "tx-1", pending_payment_button_id: "btn_0" })
      );
    });

    it("does not fall back to a paid:*/not_paid:* edge when a non-payment button has no matching edge", async () => {
      makePaymentFlow();
      const lead = makeLeadOnFlow();

      // "garbage" matches no button id and no edge by target/sourceHandle —
      // used to hit the old blind edges[0] fallback, which (before the fix)
      // resolved to the paid:btn_0 edge since it's listed first. The fix
      // doesn't have to avoid falling back entirely (that's the existing,
      // separate "single connected edge" fallback design) — it just must
      // never land on the payment-outcome branches for an unrelated click.
      await processor.handleCallbackQuery({ id: "bot-1", tenant_id: "tenant-1" }, lead, mockTelegram as any, 12345, "button-1:garbage");

      expect(mockHandleProductPaymentCallback).not.toHaveBeenCalled();
      expect(mockTelegram.sendMessage).not.toHaveBeenCalledWith({ chatId: 12345, text: "Pagamento confirmado" });
      expect(mockTelegram.sendMessage).not.toHaveBeenCalledWith({ chatId: 12345, text: "Pagamento não confirmado" });
    });

    it("does not fall back at all when the button node has ONLY payment edges", async () => {
      const flow = makePaymentFlow();
      flow.flow_data.edges = flow.flow_data.edges.filter((e) => e.id !== "e-goto");
      flowByIdCache.set(flow.id, flow as any);
      const lead = makeLeadOnFlow();

      await processor.handleCallbackQuery({ id: "bot-1", tenant_id: "tenant-1" }, lead, mockTelegram as any, 12345, "button-1:garbage");

      expect(mockHandleProductPaymentCallback).not.toHaveBeenCalled();
      expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    });

    it("forwards the button's own sale_type onto ctx.node.data (not just the node-level default)", async () => {
      const flow = makePaymentFlow();
      (flow.flow_data.nodes[0].data.buttons as any[])[0].sale_type = "upsell";
      flowByIdCache.set(flow.id, flow as any);
      const lead = makeLeadOnFlow();
      mockHandleProductPaymentCallback.mockResolvedValueOnce({ nextNodeId: "wait", stateUpdates: {} });

      await processor.handleCallbackQuery({ id: "bot-1", tenant_id: "tenant-1" }, lead, mockTelegram as any, 12345, "button-1:btn_0");

      const ctxArg = mockHandleProductPaymentCallback.mock.calls[0][0];
      expect(ctxArg.node.data.sale_type).toBe("upsell");
    });

    it("also excludes the dedicated payment_button node's plain paid/not_paid handles from the edges[0] fallback", async () => {
      // Mirrors payment-button-node.tsx: dedicated payment node uses
      // un-namespaced "paid"/"not_paid" handles, plus per-button handles
      // for reject/custom buttons (callback_data `${nodeId}:${id}`).
      const flow = {
        id: "flow-dedicated",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        name: "Dedicated Payment Flow",
        trigger_type: "command",
        trigger_value: "/start",
        flow_data: {
          nodes: [
            { id: "pay-node", type: "payment_button", data: { bundle_id: "b-1", sale_type: "upsell" }, position: { x: 0, y: 0 } },
            { id: "paid-node", type: "text", data: { text: "Pagamento confirmado" }, position: { x: 0, y: 100 } },
          ],
          edges: [
            // "paid" listed first — the exact shape that would previously
            // slip past a filter that only matched "paid:"/"not_paid:".
            { id: "e-paid", source: "pay-node", target: "paid-node", sourceHandle: "paid" },
          ],
        },
        is_active: true,
        version: 1,
        created_at: "",
        updated_at: "",
      };
      flowByIdCache.set(flow.id, flow as any);
      const lead = { ...makeLead(), current_flow_id: "flow-dedicated", current_node_id: "pay-node" };

      // "reject" has no matching edge (never connected in the editor).
      await processor.handleCallbackQuery({ id: "bot-1", tenant_id: "tenant-1" }, lead, mockTelegram as any, 12345, "pay-node:reject");

      expect(mockTelegram.sendMessage).not.toHaveBeenCalledWith({ chatId: 12345, text: "Pagamento confirmado" });
    });
  });
});

describe("auto-delete por bloco", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");
  let processor: FlowProcessor;
  let insertedRows: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    flowByIdCache.clear();
    insertedRows = [];

    // Só a fila de deleção toca o banco neste cenário — qualquer outra tabela
    // é bug no teste e deve estourar, não passar batido.
    mockDb.from.mockImplementation((table: string) => {
      if (table !== "message_delete_queue") throw new Error(`unexpected table: ${table}`);
      return {
        insert: (rows: Record<string, unknown>[]) => {
          insertedRows.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
    });

    // Sem message_id de volta, o nó não devolve messageIds e não há o que deletar.
    mockTelegram.sendMessage.mockImplementation(() =>
      Promise.resolve({ message_id: 900 + insertedRows.length }),
    );

    processor = new FlowProcessor(
      mockDb as any,
      mockLeadService as any,
      mockQueue as any,
      { gateway: {} as any, gatewayKind: "sigilopay", baseWebhookUrl: "https://example.com" },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    mockDb.from.mockReset();
    mockTelegram.sendMessage.mockReset();
  });

  /** Segundos entre o `delete_at` da linha enfileirada e o "agora" congelado. */
  function delayOf(row: Record<string, unknown>): number {
    return (new Date(String(row.delete_at)).getTime() - NOW.getTime()) / 1000;
  }

  function flowWith(autoDeleteSeconds?: number) {
    const flow = makeFlow();
    (flow.flow_data.nodes[1] as any).data.auto_delete_seconds = autoDeleteSeconds;
    // Só o primeiro nó de texto interessa aqui — o segundo fica sem config.
    flow.flow_data.edges = [{ id: "e1", source: "trigger-1", target: "text-1" }];
    return flow;
  }

  it("enfileira a deleção do bloco configurado num fluxo comum", async () => {
    await processor.executeFlow(flowWith(30) as any, makeLead(), mockTelegram as any, 12345);

    expect(insertedRows).toHaveLength(1);
    expect(delayOf(insertedRows[0])).toBe(30);
    expect(insertedRows[0]).toMatchObject({ bot_id: "bot-1", chat_id: 12345, status: "pending" });
  });

  it("não enfileira nada quando o bloco não tem auto-delete e o fluxo também não", async () => {
    await processor.executeFlow(flowWith(undefined) as any, makeLead(), mockTelegram as any, 12345);

    expect(insertedRows).toHaveLength(0);
  });

  it("mantém os 15min do black flow no bloco sem auto-delete próprio", async () => {
    await processor.executeFlow(flowWith(undefined) as any, makeLead(), mockTelegram as any, 12345, undefined, true);

    expect(insertedRows).toHaveLength(1);
    expect(delayOf(insertedRows[0])).toBe(15 * 60);
  });

  it("o tempo do bloco tem precedência sobre o do black flow", async () => {
    await processor.executeFlow(flowWith(45) as any, makeLead(), mockTelegram as any, 12345, undefined, true);

    expect(insertedRows).toHaveLength(1);
    expect(delayOf(insertedRows[0])).toBe(45);
  });

  it("o tempo do bloco tem precedência sobre o deleteAfterMinutes do fluxo", async () => {
    await processor.executeFlow(flowWith(45) as any, makeLead(), mockTelegram as any, 12345, undefined, false, 120);

    expect(insertedRows).toHaveLength(1);
    expect(delayOf(insertedRows[0])).toBe(45);
  });

  it("aplica o deleteAfterMinutes do fluxo em minutos, não em segundos", async () => {
    await processor.executeFlow(flowWith(undefined) as any, makeLead(), mockTelegram as any, 12345, undefined, false, 2);

    expect(insertedRows).toHaveLength(1);
    expect(delayOf(insertedRows[0])).toBe(120);
  });

  it("ignora valor inválido no bloco e cai na regra do fluxo", async () => {
    await processor.executeFlow(flowWith(-5) as any, makeLead(), mockTelegram as any, 12345, undefined, true);

    expect(insertedRows).toHaveLength(1);
    expect(delayOf(insertedRows[0])).toBe(15 * 60);
  });
});
