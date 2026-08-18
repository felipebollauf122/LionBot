import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramApi } from "../telegram/api.js";
import type { NodeContext, FlowNode, FlowEdge, Lead } from "./types.js";
import { executeNode } from "./node-executor.js";
import { handleInputResponse } from "./nodes/input.js";
import type { LeadService } from "../services/lead-service.js";
import type { ExecuteNodeDeps } from "./node-executor.js";
import type { PaymentGateway } from "../services/payment-gateway.js";
import { flowCache, flowByIdCache } from "../cache.js";
import { logEvent } from "../services/lead-messages.js";

const BLACK_DELETE_DELAY_MINUTES = 15;

export interface Flow {
  id: string;
  tenant_id: string;
  bot_id: string;
  name: string;
  trigger_type: string;
  trigger_value: string;
  flow_data: {
    nodes: FlowNode[];
    edges: FlowEdge[];
  };
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

interface DelayQueue {
  addDelayedJob(data: {
    leadId: string;
    flowId: string;
    nodeId: string;
    botId: string;
    tenantId: string;
    chatId: number;
  }, delaySeconds: number): Promise<void>;
}

export class FlowProcessor {
  private executeDeps: ExecuteNodeDeps;

  constructor(
    private db: SupabaseClient,
    private leadService: LeadService,
    private delayQueue: DelayQueue,
    deps?: {
      gateway?: PaymentGateway;
      gatewayKind?: "sigilopay" | "evpay" | "zuckpay";
      baseWebhookUrl?: string;
    },
  ) {
    this.executeDeps = {
      db: this.db,
      gateway: deps?.gateway,
      gatewayKind: deps?.gatewayKind ?? "sigilopay",
      baseWebhookUrl: deps?.baseWebhookUrl,
    };
  }

  /**
   * Fetch a flow by ID, using in-memory cache to avoid repeated DB queries.
   */
  private async getFlowById(flowId: string): Promise<Flow | null> {
    const cached = flowByIdCache.get(flowId);
    if (cached) return cached as unknown as Flow;

    const { data } = await this.db
      .from("flows")
      .select("*")
      .eq("id", flowId)
      .single();

    if (data) {
      flowByIdCache.set(flowId, data);
      return data as Flow;
    }
    return null;
  }

  /**
   * Fetch all active flows for a bot, using in-memory cache.
   */
  private async getActiveFlows(botId: string): Promise<Flow[]> {
    const cached = flowCache.get(botId);
    if (cached) return cached as unknown as Flow[];

    const { data } = await this.db
      .from("flows")
      .select("*")
      .eq("bot_id", botId)
      .eq("is_active", true);

    if (data) {
      flowCache.set(botId, data);
      // Also populate individual flow cache
      for (const f of data) {
        flowByIdCache.set((f as unknown as Flow).id, f);
      }
      return data as Flow[];
    }
    return [];
  }

  /**
   * Fetch a named flow (e.g. _visual_flow, _black_flow) for a bot.
   * Always falls back to a fresh DB query if not found in cache —
   * critical for _black_flow which must never be silently skipped.
   */
  private async getNamedFlow(botId: string, name: string): Promise<Flow | null> {
    // Try from the active flows cache first
    const flows = await this.getActiveFlows(botId);
    const cached = flows.find((f) => f.name === name && f.is_active);
    if (cached) return cached;

    // Cache miss — query DB directly (bypasses stale cache)
    console.log(`[flow] getNamedFlow: "${name}" not in cache for bot ${botId}, querying DB directly`);
    const { data } = await this.db
      .from("flows")
      .select("*")
      .eq("bot_id", botId)
      .eq("name", name)
      .eq("is_active", true)
      .maybeSingle();

    if (data) {
      // Populate cache so subsequent calls don't miss
      flowByIdCache.set((data as unknown as Flow).id, data);
      return data as Flow;
    }

    console.log(`[flow] getNamedFlow: "${name}" not found in DB for bot ${botId}`);
    return null;
  }

  /**
   * Queue a message for deletion after `delayMinutes` minutes.
   */
  private async queueMessageDeletion(
    botId: string,
    botToken: string,
    chatId: number,
    messageId: number,
    delayMinutes: number,
  ): Promise<void> {
    const deleteAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
    await this.db.from("message_delete_queue").insert({
      bot_id: botId,
      bot_token: botToken,
      chat_id: chatId,
      message_id: messageId,
      delete_at: deleteAt,
      status: "pending",
    });
  }

  /**
   * Execute a flow. If isBlack=true, messages are queued for deletion after 15min (black flow default).
   * If deleteAfterMinutes is provided, overrides isBlack and uses that delay instead.
   */
  async executeFlow(
    flow: Flow,
    lead: Lead,
    telegram: TelegramApi,
    chatId: number,
    startNodeId?: string,
    isBlack?: boolean,
    deleteAfterMinutes?: number | null,
    persistPosition: boolean = true,
  ): Promise<{ blocked?: boolean }> {
    const deletionDelay =
      deleteAfterMinutes && deleteAfterMinutes > 0
        ? deleteAfterMinutes
        : isBlack
        ? BLACK_DELETE_DELAY_MINUTES
        : null;
    // Blindagem (bug black flow): flow_data pode vir null/corrompido ou sem nós.
    // Antes isso virava crash (destructuring de null) ou silêncio total. Agora
    // logamos claramente o motivo pra nunca falhar "invisível".
    const flowData = flow.flow_data as { nodes?: typeof flow.flow_data.nodes; edges?: typeof flow.flow_data.edges } | null;
    if (!flowData || !Array.isArray(flowData.nodes)) {
      console.error(`[flow] ✗ flow ${flow.id} (${flow.name ?? "?"}) com flow_data inválido/vazio${isBlack ? " [BLACK]" : ""} — nada a executar`);
      return {};
    }
    const nodes = flowData.nodes;
    const edges = Array.isArray(flowData.edges) ? flowData.edges : [];

    let currentNodeId = startNodeId ?? nodes.find((n) => n.type === "trigger")?.id;
    if (!currentNodeId) {
      console.error(`[flow] ✗ flow ${flow.id} (${flow.name ?? "?"}) sem nó 'trigger'${isBlack ? " [BLACK]" : ""} — nada a enviar. Configure o gatilho do fluxo.`);
      return {};
    }

    const MAX_ITERATIONS = 50;
    let iterations = 0;

    while (currentNodeId && iterations < MAX_ITERATIONS) {
      iterations++;

      const node = nodes.find((n) => n.id === currentNodeId);
      if (!node) {
        console.log(`[flow] Node ${currentNodeId} not found in flow ${flow.id}`);
        break;
      }

      console.log(`[flow] Executing node ${node.id} (type=${node.type}) iteration=${iterations}${isBlack ? " [BLACK]" : ""}`);

      const nodeEdges = edges.filter((e) => e.source === currentNodeId);

      const ctx: NodeContext = {
        node,
        lead,
        edges: nodeEdges,
        telegram,
        chatId,
      };

      const result = await executeNode(ctx, this.executeDeps);
      console.log(`[flow] Node ${node.id} result: nextNodeId=${result.nextNodeId}, stateUpdates=${!!result.stateUpdates}`);

      // User blocked the bot — stop flow immediately
      if (result.blocked) {
        console.log(`[flow] Lead ${lead.id} blocked the bot, stopping flow`);
        // Marca o lead como bloqueado + registra na timeline do chat (aba
        // Clientes). Fire-and-forget: não atrapalha o stop do flow.
        void this.db.from("leads").update({ blocked: true }).eq("id", lead.id);
        logEvent(
          { leadId: lead.id, botId: flow.bot_id, tenantId: lead.tenant_id },
          "blocked",
          "Lead bloqueou o bot",
        );
        return { blocked: true };
      }

      // Auto-delete: black flow (15min) or explicit deleteAfterMinutes
      if (deletionDelay && result.messageIds) {
        for (const msgId of result.messageIds) {
          await this.queueMessageDeletion(flow.bot_id, telegram.botToken, chatId, msgId, deletionDelay);
        }
      }

      // Combina state + posição num único write quando há delay node com
      // persistPosition (#33) — evita 2 roundtrips. Nos demais casos,
      // mantém os updates separados como antes.
      const isDelayPersist =
        !!result.delaySeconds && result.delaySeconds > 0 && !!result.nextNodeId && persistPosition;

      if (result.stateUpdates) {
        lead.state = { ...lead.state, ...result.stateUpdates };
        if (!isDelayPersist) {
          await this.leadService.updateState(lead.id, lead.state);
        }
      }

      if (result.delaySeconds && result.delaySeconds > 0 && result.nextNodeId) {
        if (persistPosition) {
          if (result.stateUpdates) {
            await this.leadService.updatePositionAndState(
              lead.id,
              flow.id,
              result.nextNodeId,
              lead.state,
            );
          } else {
            await this.leadService.updatePosition(lead.id, flow.id, result.nextNodeId);
          }
          await this.delayQueue.addDelayedJob(
            {
              leadId: lead.id,
              flowId: flow.id,
              nodeId: result.nextNodeId,
              botId: flow.bot_id,
              tenantId: flow.tenant_id,
              chatId,
            },
            result.delaySeconds,
          );
        } else {
          // Remarketing: não persiste posição (flow.id não está em `flows`).
          // Delay vira sleep inline curto pra não bloquear o worker.
          const ms = Math.min(result.delaySeconds * 1000, 30_000);
          await new Promise((r) => setTimeout(r, ms));
          currentNodeId = result.nextNodeId;
          continue;
        }
        return {};
      }

      if (result.nextNodeId === "wait") {
        if (persistPosition) {
          await this.leadService.updatePosition(lead.id, flow.id, node.id);
        }
        return {};
      }

      if (result.nextNodeId === null) {
        if (persistPosition) {
          await this.leadService.updatePosition(lead.id, null, null);
        }
        return {};
      }

      currentNodeId = result.nextNodeId;
    }

    if (persistPosition) {
      await this.leadService.updatePosition(lead.id, null, null);
    }
    return {};
  }

  /**
   * Handle /start command with flow routing.
   * Finds the named flow (_visual_flow or _black_flow) and executes it.
   * Sets active_flow_name on the lead.
   */
  async handleStartCommand(
    bot: { id: string; tenant_id: string; telegram_token: string },
    lead: Lead,
    telegram: TelegramApi,
    chatId: number,
    messageText: string,
    flowName: string,
  ): Promise<void> {
    console.log(`[flow] handleStartCommand: looking for flow "${flowName}" in bot ${bot.id}, lead=${lead.id}`);

    // Find the named flow (cache + DB fallback)
    const flow = await this.getNamedFlow(bot.id, flowName);

    if (flow) {
      const typedFlow = flow;
      const isBlack = flowName === "_black_flow";

      // Set active_flow_name on lead
      await this.leadService.updatePosition(lead.id, typedFlow.id, null, flowName);
      lead.current_flow_id = typedFlow.id;
      lead.active_flow_name = flowName;

      console.log(`[flow] ✓ Executing ${flowName} (flowId=${typedFlow.id}, nodes=${typedFlow.flow_data.nodes.length}, edges=${typedFlow.flow_data.edges.length})${isBlack ? " [BLACK]" : ""} for lead ${lead.id}`);
      await this.executeFlow(typedFlow, lead, telegram, chatId, undefined, isBlack);
      return;
    }

    // Named flow not found — this is a PROBLEM if flowName is _black_flow
    if (flowName === "_black_flow") {
      console.error(`[flow] ✗ CRITICAL: _black_flow was selected but NOT FOUND in DB for bot ${bot.id}! Check that the flow exists, is_active=true, and name="_black_flow". Falling back to trigger matching.`);
    } else {
      console.log(`[flow] Flow "${flowName}" not found, falling back to trigger matching`);
    }
    await this.handleIncomingMessage(bot, lead, telegram, chatId, messageText);
  }

  async handleIncomingMessage(
    bot: { id: string; tenant_id: string; telegram_token: string },
    lead: Lead,
    telegram: TelegramApi,
    chatId: number,
    messageText: string,
  ): Promise<void> {
    const isBlack = lead.active_flow_name === "_black_flow";

    if (lead.current_flow_id && lead.current_node_id) {
      const flow = await this.getFlowById(lead.current_flow_id);

      if (flow) {
        const currentNode = flow.flow_data.nodes.find(
          (n) => n.id === lead.current_node_id
        );

        if (currentNode?.type === "input") {
          const variable = String(currentNode.data.variable ?? "");
          const edges = flow.flow_data.edges.filter(
            (e) => e.source === currentNode.id
          );
          const result = handleInputResponse(currentNode.id, variable, messageText, edges);

          if (result.stateUpdates) {
            lead.state = { ...lead.state, ...result.stateUpdates };
            await this.leadService.updateState(lead.id, lead.state);
          }

          if (result.nextNodeId && result.nextNodeId !== "wait") {
            await this.executeFlow(flow, lead, telegram, chatId, result.nextNodeId, isBlack);
          }
          return;
        }

        // If lead is waiting on a button or payment node, ignore text messages.
        // Commands (starting with /) are allowed through so they can trigger a new flow.
        if (currentNode?.type === "button" || currentNode?.type === "payment_button") {
          if (!messageText.startsWith("/")) {
            console.log(`[flow] Lead ${lead.id} is waiting on ${currentNode.type} node, ignoring text message`);
            return;
          }
        }
      }
    }

    const flows = await this.getActiveFlows(bot.id);

    if (flows.length === 0) {
      console.log(`[flow] No active flows found for bot ${bot.id}`);
      return;
    }

    console.log(`[flow] Checking ${flows.length} active flow(s) for message "${messageText}"`);

    for (const flow of flows) {
      // Skip _black_flow and _visual_flow from trigger matching —
      // they are only entered via handleStartCommand
      if (flow.name === "_black_flow" || flow.name === "_visual_flow") continue;

      const triggerNode = flow.flow_data.nodes.find((n) => n.type === "trigger");
      if (!triggerNode) continue;

      const triggerType = String(triggerNode.data.trigger ?? flow.trigger_type);
      const triggerValue = String(triggerNode.data.command ?? flow.trigger_value);

      console.log(`[flow] Flow "${flow.name}" (${flow.id}): trigger=${triggerType}, value="${triggerValue}"`);

      const messageCommand = messageText.split(" ")[0];
      if (triggerType === "command" && (messageText === triggerValue || messageCommand === triggerValue)) {
        console.log(`[flow] ✓ Matched command trigger, executing flow "${flow.name}"`);
        await this.executeFlow(flow, lead, telegram, chatId);
        return;
      }

      if (triggerType === "first_contact" && !lead.current_flow_id) {
        console.log(`[flow] ✓ Matched first_contact trigger, executing flow "${flow.name}"`);
        await this.executeFlow(flow, lead, telegram, chatId);
        return;
      }
    }

    console.log(`[flow] No trigger matched for message "${messageText}"`);
  }

  async handleCallbackQuery(
    bot: { id: string; tenant_id: string },
    lead: Lead,
    telegram: TelegramApi,
    chatId: number,
    callbackData: string,
  ): Promise<void> {
    const isBlack = lead.active_flow_name === "_black_flow";

    // Handle "Show QR Code" button — send QR code image
    if (callbackData.startsWith("qrcode:")) {
      const pixImage = String(lead.state.pending_pix_image ?? "");
      if (pixImage) {
        const msg = await telegram.sendPhoto({
          chatId,
          photo: pixImage,
          caption: "📱 QR Code Pix — escaneie com o app do seu banco",
        });
        if (isBlack && msg) {
          await this.queueMessageDeletion(bot.id, telegram.botToken, chatId, msg.message_id, BLACK_DELETE_DELAY_MINUTES);
        }
      } else {
        await telegram.sendMessage({
          chatId,
          text: "QR Code não disponível para este pagamento.",
        });
      }
      return;
    }

    // Handle product payment selection from bundle
    if (callbackData.startsWith("pay:")) {
      const productId = callbackData.substring(4);
      const paymentNodeId = String(lead.state.pending_payment_node_id ?? "");
      const bundleId = String(lead.state.pending_bundle_id ?? "");

      if (!productId || !paymentNodeId || !bundleId) {
        console.log(`[pay callback] Missing state: productId=${productId}, paymentNodeId=${paymentNodeId}, bundleId=${bundleId}`);
        await telegram.sendMessage({
          chatId,
          text: "Sua sessão expirou. Volte e selecione o produto novamente.",
        });
        return;
      }

      // Constrói node sintético direto do state (suporta tanto flows visuais
      // quanto flows de remarketing, que não estão em `flows`).
      const paymentNode = {
        id: paymentNodeId,
        type: "payment_button",
        data: { bundle_id: bundleId },
      } as unknown as NodeContext["node"];

      const ctx: NodeContext = {
        node: paymentNode,
        lead,
        edges: [],
        telegram,
        chatId,
      };

      const { handleProductPaymentCallback } = await import("./nodes/payment-button.js");

      if (!this.executeDeps.db || !this.executeDeps.gateway || !this.executeDeps.baseWebhookUrl) {
        console.error("[pay callback] Missing deps");
        return;
      }

      try {
        const result = await handleProductPaymentCallback(
          ctx,
          this.executeDeps.db,
          this.executeDeps.gateway,
          this.executeDeps.baseWebhookUrl,
          productId,
          this.executeDeps.gatewayKind ?? "sigilopay",
        );

        // Queue black flow messages for deletion (apenas em flows visuais black)
        if (isBlack && result.messageIds && lead.current_flow_id) {
          const typedFlow = await this.getFlowById(lead.current_flow_id);
          if (typedFlow) {
            for (const msgId of result.messageIds) {
              await this.queueMessageDeletion(typedFlow.bot_id, telegram.botToken, chatId, msgId, BLACK_DELETE_DELAY_MINUTES);
            }
          }
        }

        if (result.stateUpdates) {
          lead.state = { ...lead.state, ...result.stateUpdates };
          await this.leadService.updateState(lead.id, lead.state);
        }
      } catch (error) {
        console.error("[pay callback] Error processing payment:", error);
        await telegram.sendMessage({
          chatId,
          text: "Ocorreu um erro ao processar o pagamento. Tente novamente.",
        });
      }
      return;
    }

    // Standard button callback: format is "nodeId:value"
    const colonIndex = callbackData.indexOf(":");
    if (colonIndex === -1) return;
    const sourceNodeId = callbackData.substring(0, colonIndex);
    const targetValue = callbackData.substring(colonIndex + 1);
    if (!sourceNodeId) return;

    if (!lead.current_flow_id) {
      console.log(`[callback] Lead ${lead.id} has no current_flow_id, ignoring`);
      return;
    }

    const typedFlow = await this.getFlowById(lead.current_flow_id);

    if (!typedFlow) {
      console.log(`[callback] Flow ${lead.current_flow_id} not found`);
      return;
    }

    const edges = typedFlow.flow_data.edges.filter((e) => e.source === sourceNodeId);

    let edge = edges.find(
      (e) => e.sourceHandle === targetValue || e.target === targetValue
    );

    if (!edge && edges.length > 0) {
      edge = edges[0];
    }

    if (edge) {
      console.log(`[callback] Advancing flow from ${sourceNodeId} to ${edge.target}${isBlack ? " [BLACK]" : ""}`);
      await this.executeFlow(typedFlow, lead, telegram, chatId, edge.target, isBlack);
    } else {
      console.log(`[callback] No edge found for source ${sourceNodeId}, value ${targetValue}`);
    }
  }
}
