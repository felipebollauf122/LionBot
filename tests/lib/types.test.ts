import { describe, it, expect } from "vitest";
import type {
  TransactionStatus,
  TriggerType,
  TrackingEventType,
  TrackingMode,
  NodeType,
  FlowNode,
  FlowEdge,
  FlowData,
  Tenant,
  Bot,
  Product,
  Flow,
  Lead,
  Transaction,
  TrackingEvent,
  TrafficFilterRule,
  TrafficFilterList,
  TrafficFilterMatchType,
} from "@/lib/types/database";

describe("Database Types", () => {
  describe("Tenant", () => {
    it("should create a valid Tenant object", () => {
      const tenant: Tenant = {
        id: "tenant-1",
        email: "user@example.com",
        name: "Test User",
        plan: "pro",
        created_at: "2026-04-01T10:00:00Z",
      };

      expect(tenant.id).toBe("tenant-1");
      expect(tenant.email).toBe("user@example.com");
      expect(tenant.name).toBe("Test User");
      expect(tenant.plan).toBe("pro");
      expect(tenant.created_at).toBe("2026-04-01T10:00:00Z");
    });

    it("should allow null plan in Tenant", () => {
      const tenant: Tenant = {
        id: "tenant-2",
        email: "user2@example.com",
        name: "Another User",
        plan: null,
        created_at: "2026-04-01T11:00:00Z",
      };

      expect(tenant.plan).toBeNull();
    });
  });

  describe("Bot", () => {
    it("should create a valid Bot object", () => {
      const bot: Bot = {
        id: "bot-1",
        tenant_id: "tenant-1",
        telegram_token: "token123",
        bot_username: "test_bot",
        webhook_url: "https://example.com/webhook",
        is_active: true,
        facebook_pixel_id: "pixel-123",
        facebook_access_token: "fb-token",
        utmify_api_key: "utmify-key",
        sigilopay_public_key: "sigilopay-pub-key",
        sigilopay_secret_key: "sigilopay-sec-key",
        tracking_mode: "redirect",
        prelander_headline: null,
        prelander_description: null,
        prelander_image_url: null,
        prelander_cta_text: null,
        traffic_filter_enabled: false,
        created_at: "2026-04-01T10:00:00Z",
      };

      expect(bot.id).toBe("bot-1");
      expect(bot.tenant_id).toBe("tenant-1");
      expect(bot.telegram_token).toBe("token123");
      expect(bot.is_active).toBe(true);
      expect(bot.tracking_mode).toBe("redirect");
    });

    it("should support prelander tracking mode", () => {
      const bot: Bot = {
        id: "bot-2",
        tenant_id: "tenant-1",
        telegram_token: "token456",
        bot_username: "prelander_bot",
        webhook_url: "https://example.com/webhook",
        is_active: true,
        facebook_pixel_id: null,
        facebook_access_token: null,
        utmify_api_key: null,
        sigilopay_public_key: null,
        sigilopay_secret_key: null,
        tracking_mode: "prelander",
        prelander_headline: "Amazing Offer",
        prelander_description: "Check out this incredible deal",
        prelander_image_url: "https://example.com/image.jpg",
        prelander_cta_text: "Learn More",
        created_at: "2026-04-01T11:00:00Z",
      };

      expect(bot.tracking_mode).toBe("prelander");
      expect(bot.prelander_headline).toBe("Amazing Offer");
    });
  });

  describe("Product", () => {
    it("should create a valid Product object", () => {
      const product: Product = {
        id: "product-1",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        name: "Premium Package",
        price: 99.99,
        currency: "USD",
        description: "A premium package with great features",
        is_active: true,
        created_at: "2026-04-01T10:00:00Z",
      };

      expect(product.id).toBe("product-1");
      expect(product.name).toBe("Premium Package");
      expect(product.price).toBe(99.99);
      expect(product.currency).toBe("USD");
      expect(product.is_active).toBe(true);
    });

    it("should allow inactive products", () => {
      const product: Product = {
        id: "product-2",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        name: "Discontinued Item",
        price: 50.0,
        currency: "EUR",
        description: "No longer available",
        is_active: false,
        created_at: "2026-04-01T12:00:00Z",
      };

      expect(product.is_active).toBe(false);
    });
  });

  describe("Flow", () => {
    it("should create a valid Flow object with nodes and edges", () => {
      const flowData: FlowData = {
        nodes: [
          {
            id: "node-1",
            type: "trigger",
            data: { command: "/start" },
            position: { x: 0, y: 0 },
          },
          {
            id: "node-2",
            type: "text",
            data: { text: "Welcome!" },
            position: { x: 100, y: 100 },
          },
        ],
        edges: [
          {
            id: "edge-1",
            source: "node-1",
            target: "node-2",
          },
        ],
      };

      const flow: Flow = {
        id: "flow-1",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        name: "Welcome Flow",
        trigger_type: "command",
        trigger_value: "/start",
        flow_data: flowData,
        is_active: true,
        version: 1,
        created_at: "2026-04-01T10:00:00Z",
        updated_at: "2026-04-01T10:00:00Z",
      };

      expect(flow.id).toBe("flow-1");
      expect(flow.trigger_type).toBe("command");
      expect(flow.flow_data.nodes).toHaveLength(2);
      expect(flow.flow_data.edges).toHaveLength(1);
      expect(flow.version).toBe(1);
    });

    it("should support different trigger types", () => {
      const triggerTypes: TriggerType[] = ["command", "first_contact", "callback", "payment_event"];

      triggerTypes.forEach((triggerType) => {
        const flow: Flow = {
          id: `flow-${triggerType}`,
          tenant_id: "tenant-1",
          bot_id: "bot-1",
          name: `${triggerType} Flow`,
          trigger_type: triggerType,
          trigger_value: triggerType,
          flow_data: { nodes: [], edges: [] },
          is_active: true,
          version: 1,
          created_at: "2026-04-01T10:00:00Z",
          updated_at: "2026-04-01T10:00:00Z",
        };

        expect(flow.trigger_type).toBe(triggerType);
      });
    });

    it("should support all node types", () => {
      const nodeTypes: NodeType[] = [
        "trigger",
        "text",
        "image",
        "button",
        "payment_button",
        "delay",
        "condition",
        "input",
        "action",
      ];

      nodeTypes.forEach((nodeType) => {
        const node: FlowNode = {
          id: `node-${nodeType}`,
          type: nodeType,
          data: {},
          position: { x: 0, y: 0 },
        };

        expect(node.type).toBe(nodeType);
      });
    });
  });

  describe("Lead", () => {
    it("should create a valid Lead object", () => {
      const lead: Lead = {
        id: "lead-1",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        telegram_user_id: 123456789,
        first_name: "John",
        last_name: "Doe",
        username: "john_doe",
        tid: "tid-123",
        fbclid: "fbclid-456",
        utm_source: "facebook",
        utm_medium: "cpc",
        utm_campaign: "summer_sale",
        utm_content: "banner",
        utm_term: "premium",
        current_flow_id: "flow-1",
        current_node_id: "node-2",
        active_flow_name: "_visual_flow",
        state: { step: 1, answered: true },
        blocked: false,
        created_at: "2026-04-01T10:00:00Z",
        updated_at: "2026-04-01T11:00:00Z",
      };

      expect(lead.id).toBe("lead-1");
      expect(lead.telegram_user_id).toBe(123456789);
      expect(lead.first_name).toBe("John");
      expect(lead.state.step).toBe(1);
    });

    it("should allow null optional fields in Lead", () => {
      const lead: Lead = {
        id: "lead-2",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        telegram_user_id: 987654321,
        first_name: "Jane",
        last_name: null,
        username: null,
        tid: null,
        fbclid: null,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
        current_flow_id: null,
        current_node_id: null,
        active_flow_name: null,
        state: {},
        blocked: false,
        created_at: "2026-04-01T10:00:00Z",
        updated_at: "2026-04-01T10:00:00Z",
      };

      expect(lead.username).toBeNull();
      expect(lead.current_flow_id).toBeNull();
      expect(lead.state).toEqual({});
    });
  });

  describe("Transaction", () => {
    it("should create a valid Transaction object", () => {
      const transaction: Transaction = {
        id: "txn-1",
        tenant_id: "tenant-1",
        lead_id: "lead-1",
        bot_id: "bot-1",
        flow_id: "flow-1",
        product_id: "product-1",
        gateway: "stripe",
        external_id: "stripe-txn-123",
        amount: 99.99,
        currency: "USD",
        status: "approved",
        paid_at: "2026-04-01T10:30:00Z",
        created_at: "2026-04-01T10:00:00Z",
        remarketing_flow_id: null,
        remarketing_send_id: null,
      };

      expect(transaction.id).toBe("txn-1");
      expect(transaction.amount).toBe(99.99);
      expect(transaction.status).toBe("approved");
      expect(transaction.gateway).toBe("stripe");
    });

    it("should support all transaction statuses", () => {
      const statuses: TransactionStatus[] = ["pending", "approved", "refused", "refunded"];

      statuses.forEach((status) => {
        const transaction: Transaction = {
          id: `txn-${status}`,
          tenant_id: "tenant-1",
          lead_id: "lead-1",
          bot_id: "bot-1",
          flow_id: "flow-1",
          product_id: "product-1",
          gateway: "stripe",
          external_id: `stripe-${status}`,
          amount: 50.0,
          currency: "USD",
          status,
          paid_at: status === "approved" ? "2026-04-01T10:30:00Z" : null,
          created_at: "2026-04-01T10:00:00Z",
          remarketing_flow_id: null,
          remarketing_send_id: null,
        };

        expect(transaction.status).toBe(status);
      });
    });

    it("should allow null paid_at for non-approved transactions", () => {
      const transaction: Transaction = {
        id: "txn-pending",
        tenant_id: "tenant-1",
        lead_id: "lead-1",
        bot_id: "bot-1",
        flow_id: "flow-1",
        product_id: "product-1",
        gateway: "stripe",
        external_id: "stripe-pending",
        amount: 50.0,
        currency: "USD",
        status: "pending",
        paid_at: null,
        created_at: "2026-04-01T10:00:00Z",
        remarketing_flow_id: null,
        remarketing_send_id: null,
      };

      expect(transaction.paid_at).toBeNull();
    });
  });

  describe("TrackingEvent", () => {
    it("should create a valid TrackingEvent object", () => {
      const event: TrackingEvent = {
        id: "event-1",
        tenant_id: "tenant-1",
        lead_id: "lead-1",
        bot_id: "bot-1",
        event_type: "purchase",
        fbclid: "fbclid-123",
        tid: "tid-456",
        utm_params: {
          utm_source: "facebook",
          utm_medium: "cpc",
          utm_campaign: "summer_sale",
        },
        event_data: { value: 99.99, currency: "USD" },
        sent_to_facebook: true,
        sent_to_utmify: true,
        created_at: "2026-04-01T10:30:00Z",
      };

      expect(event.id).toBe("event-1");
      expect(event.event_type).toBe("purchase");
      expect(event.sent_to_facebook).toBe(true);
      expect(event.utm_params.utm_source).toBe("facebook");
    });

    it("should support all tracking event types", () => {
      const eventTypes: TrackingEventType[] = ["page_view", "bot_start", "view_offer", "checkout", "purchase"];

      eventTypes.forEach((eventType) => {
        const event: TrackingEvent = {
          id: `event-${eventType}`,
          tenant_id: "tenant-1",
          lead_id: null,
          bot_id: "bot-1",
          event_type: eventType,
          fbclid: null,
          tid: null,
          utm_params: {},
          event_data: {},
          sent_to_facebook: false,
          sent_to_utmify: false,
          created_at: "2026-04-01T10:00:00Z",
        };

        expect(event.event_type).toBe(eventType);
      });
    });

    it("should allow null lead_id in TrackingEvent", () => {
      const event: TrackingEvent = {
        id: "event-anonymous",
        tenant_id: "tenant-1",
        lead_id: null,
        bot_id: "bot-1",
        event_type: "page_view",
        fbclid: null,
        tid: null,
        utm_params: {},
        event_data: {},
        sent_to_facebook: false,
        sent_to_utmify: false,
        created_at: "2026-04-01T10:00:00Z",
      };

      expect(event.lead_id).toBeNull();
    });

    it("should track utm_params as dynamic object", () => {
      const event: TrackingEvent = {
        id: "event-2",
        tenant_id: "tenant-1",
        lead_id: "lead-1",
        bot_id: "bot-1",
        event_type: "bot_start",
        fbclid: null,
        tid: null,
        utm_params: {
          utm_source: "organic",
          utm_medium: "social",
          utm_campaign: "awareness",
          utm_content: "video",
          utm_term: "special",
        },
        event_data: { bot_version: "2.1" },
        sent_to_facebook: false,
        sent_to_utmify: true,
        created_at: "2026-04-01T10:00:00Z",
      };

      expect(Object.keys(event.utm_params)).toHaveLength(5);
      expect(event.event_data.bot_version).toBe("2.1");
    });
  });

  describe("FlowNode and FlowEdge", () => {
    it("should create FlowNode with optional handles in FlowEdge", () => {
      const edge: FlowEdge = {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        sourceHandle: "bottom",
        targetHandle: "top",
      };

      expect(edge.sourceHandle).toBe("bottom");
      expect(edge.targetHandle).toBe("top");
    });

    it("should create FlowEdge without optional handles", () => {
      const edge: FlowEdge = {
        id: "edge-2",
        source: "node-a",
        target: "node-b",
      };

      expect(edge.sourceHandle).toBeUndefined();
      expect(edge.targetHandle).toBeUndefined();
    });

    it("should support complex FlowNode data", () => {
      const node: FlowNode = {
        id: "node-complex",
        type: "button",
        data: {
          text: "Click me",
          color: "blue",
          actions: [{ type: "navigate", url: "/page" }],
          metadata: { version: 1, deprecated: false },
        },
        position: { x: 250, y: 350 },
      };

      expect(node.data.text).toBe("Click me");
      expect((node.data.actions as Array<{ type: string; url: string }>)[0].type).toBe("navigate");
      expect((node.data.metadata as Record<string, unknown>).version).toBe(1);
    });
  });

  describe("Complex integrations", () => {
    it("should create a complete flow scenario with lead and transaction", () => {
      const flow: Flow = {
        id: "flow-complete",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        name: "Complete Sales Flow",
        trigger_type: "first_contact",
        trigger_value: "first_contact",
        flow_data: {
          nodes: [
            {
              id: "node-start",
              type: "trigger",
              data: {},
              position: { x: 0, y: 0 },
            },
            {
              id: "node-offer",
              type: "text",
              data: { message: "Check out this offer!" },
              position: { x: 100, y: 100 },
            },
            {
              id: "node-payment",
              type: "payment_button",
              data: { product_id: "product-1" },
              position: { x: 200, y: 200 },
            },
          ],
          edges: [
            { id: "e1", source: "node-start", target: "node-offer" },
            { id: "e2", source: "node-offer", target: "node-payment" },
          ],
        },
        is_active: true,
        version: 2,
        created_at: "2026-04-01T10:00:00Z",
        updated_at: "2026-04-01T11:00:00Z",
      };

      const lead: Lead = {
        id: "lead-complete",
        tenant_id: "tenant-1",
        bot_id: "bot-1",
        telegram_user_id: 111222333,
        first_name: "Alice",
        last_name: "Wonderland",
        username: "alice_wonderland",
        tid: "tid-alice",
        fbclid: "fbclid-alice",
        utm_source: "facebook",
        utm_medium: "cpc",
        utm_campaign: "spring_sale",
        utm_content: "carousel",
        utm_term: "exclusive",
        current_flow_id: flow.id,
        current_node_id: "node-payment",
        active_flow_name: "_visual_flow",
        state: { flow_step: 3, viewed_offer: true, ready_to_pay: true },
        blocked: false,
        created_at: "2026-04-01T10:00:00Z",
        updated_at: "2026-04-01T11:15:00Z",
      };

      const transaction: Transaction = {
        id: "txn-complete",
        tenant_id: "tenant-1",
        lead_id: lead.id,
        bot_id: "bot-1",
        flow_id: flow.id,
        product_id: "product-1",
        gateway: "stripe",
        external_id: "ch_1234567890",
        amount: 199.99,
        currency: "USD",
        status: "approved",
        paid_at: "2026-04-01T11:20:00Z",
        created_at: "2026-04-01T11:15:00Z",
        remarketing_flow_id: null,
        remarketing_send_id: null,
      };

      expect(flow.id).toBe(lead.current_flow_id);
      expect(lead.id).toBe(transaction.lead_id);
      expect(flow.flow_data.nodes).toHaveLength(3);
      expect(transaction.status).toBe("approved");
    });
  });
});
