import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramApi } from "../telegram/api.js";
import type { NodeContext, NodeResult, FlowNode, FlowEdge, Lead } from "./types.js";
import { executeNode } from "./node-executor.js";
import { handleInputResponse } from "./nodes/input.js";
import type { LeadService } from "../services/lead-service.js";
import type { ExecuteNodeDeps } from "./node-executor.js";
import type { PaymentGateway } from "../services/payment-gateway.js";
import {
  buildGatewayByKind,
  resolveGatewayKind,
  type BotPaymentConfig,
  type GatewayKind,
} from "../services/gateway-factory.js";
import { flowCache, flowByIdCache, remarketingFlowByIdCache } from "../cache.js";
import { logEvent } from "../services/lead-messages.js";
import { resolveAutoDeleteSeconds } from "./auto-delete.js";

/** Black flow apaga tudo 15 minutos depois do envio (padrão histórico). */
const BLACK_DELETE_DELAY_SECONDS = 15 * 60;

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
      gatewayKind?: GatewayKind;
      baseWebhookUrl?: string;
      /**
       * Linha do bot (colunas de pagamento). Necessária pra construir um
       * gateway DIFERENTE do padrão quando o nó de pagamento escolhe um —
       * `gateway` acima é só o padrão, instanciado uma vez pelo caller.
       * Sem isso, a escolha por nó é ignorada e tudo cai no padrão.
       */
      botPaymentConfig?: BotPaymentConfig;
    },
  ) {
    this.executeDeps = {
      db: this.db,
      gateway: deps?.gateway,
      gatewayKind: deps?.gatewayKind ?? "sigilopay",
      baseWebhookUrl: deps?.baseWebhookUrl,
    };
    this.botPaymentConfig = deps?.botPaymentConfig;
  }

  private botPaymentConfig?: BotPaymentConfig;

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
   * Fetch a REMARKETING flow by ID (tabela `remarketing_flows`, separada de
   * `flows`) e adapta pro shape `Flow` que executeFlow/handleCallbackQuery
   * já sabem consumir — mesma adaptação que remarketing-worker.ts faz
   * manualmente em `flowForProcessor` antes de chamar executeFlow.
   *
   * Existe pro fallback de roteamento de callback: remarketing nunca seta
   * lead.current_flow_id (persistPosition=false em executeFlow), então
   * handleCallbackQuery precisa de outro jeito de achar o flow de origem
   * quando lead.state tem uma referência pendente de remarketing (ver
   * pending_remarketing_flow_id, gravado no bloco `!persistPosition` de
   * executeFlow).
   *
   * Público (não mais `private`): purchase-completer.ts também precisa
   * resolver `remarketing_flows` pra retomar o edge "paid" de uma compra
   * atribuída a remarketing (transactions.remarketing_flow_id, migration
   * 060) — mesma necessidade que o fallback de callback abaixo já tinha.
   */
  async getRemarketingFlowById(
    remarketingFlowId: string,
  ): Promise<(Flow & { deleteAfterMinutes: number | null }) | null> {
    const cached = remarketingFlowByIdCache.get(remarketingFlowId);
    if (cached) return cached as unknown as Flow & { deleteAfterMinutes: number | null };

    const { data } = await this.db
      .from("remarketing_flows")
      .select("id, tenant_id, bot_id, name, flow_data, is_active, delete_after_minutes, created_at, updated_at")
      .eq("id", remarketingFlowId)
      .maybeSingle();

    if (!data) return null;

    const adapted: Flow & { deleteAfterMinutes: number | null } = {
      id: data.id,
      tenant_id: data.tenant_id,
      bot_id: data.bot_id,
      name: data.name,
      trigger_type: "remarketing",
      trigger_value: "",
      flow_data: data.flow_data,
      is_active: data.is_active,
      version: 1,
      created_at: data.created_at,
      updated_at: data.updated_at,
      deleteAfterMinutes: (data.delete_after_minutes as number | null) ?? null,
    };
    remarketingFlowByIdCache.set(remarketingFlowId, adapted as unknown as Record<string, unknown>);
    return adapted;
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
   * Pré-carrega, uma vez por executeFlow, os media_assets referenciados por
   * nós image/video com randomize=true — evita 1 round-trip por nó (por
   * lead, por tick) no worker de remarketing. Retorna undefined (custo zero)
   * quando nenhum nó do flow usa a biblioteca.
   */
  private async loadMediaAssetsForFlow(
    nodes: FlowNode[],
  ): Promise<Map<string, { url: string; kind: "image" | "video" }> | undefined> {
    const ids = new Set<string>();
    for (const n of nodes) {
      if ((n.type === "image" || n.type === "video") && n.data.randomize === true) {
        const assetIds = Array.isArray(n.data.media_asset_ids) ? n.data.media_asset_ids : [];
        for (const id of assetIds) ids.add(String(id));
      }
    }
    if (ids.size === 0) return undefined;

    const { data } = await this.db
      .from("media_assets")
      .select("id, url, kind")
      .in("id", [...ids])
      .eq("is_active", true);

    return new Map((data ?? []).map((r) => [r.id as string, { url: r.url as string, kind: r.kind as "image" | "video" }]));
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
   * Queue a message for deletion after `delaySeconds` seconds.
   *
   * Em SEGUNDOS (não minutos) porque o auto-delete por bloco deixa o usuário
   * escolher tempos abaixo de 1 minuto. O poller roda a cada 30s, então a
   * deleção real acontece com até ~30s de atraso — o painel avisa disso.
   */
  private async queueMessageDeletion(
    botId: string,
    botToken: string,
    chatId: number,
    messageIds: number[],
    delaySeconds: number,
  ): Promise<void> {
    if (messageIds.length === 0) return;
    const deleteAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    // Insert em lote: um nó que manda várias mensagens fazia N round-trips
    // sequenciais aqui, cada um segurando o avanço pro próximo nó do flow.
    await this.db.from("message_delete_queue").insert(
      messageIds.map((messageId) => ({
        bot_id: botId,
        bot_token: botToken,
        chat_id: chatId,
        message_id: messageId,
        delete_at: deleteAt,
        status: "pending",
      })),
    );
  }

  /**
   * Gera o Pix e processa o resultado (deleção de mensagens em black flow +
   * merge de stateUpdates). Compartilhado pelos dois pontos de entrada de
   * pagamento em handleCallbackQuery (bundle "pay:" e botão de pagamento
   * inline) — mantê-los em um lugar só evita que os dois divirjam quando um
   * dos dois ganhar um fix (deps, mensagem de erro, etc) e o outro não.
   */
  private async runPaymentCallback(opts: {
    ctx: NodeContext;
    productId: string;
    paymentButtonId?: string;
    lead: Lead;
    telegram: TelegramApi;
    chatId: number;
    isBlack: boolean;
    resolveBotId: () => Promise<string | undefined>;
    logTag: string;
    remarketingFlowId?: string | null;
    remarketingSendId?: string | null;
    /**
     * Gateway escolhido no fluxo (nó de pagamento ou botão inline). Só é
     * honrado se estiver ativo e configurado no bot — ver resolveGatewayKind.
     * Ausente = usa o padrão do bot, comportamento de sempre.
     */
    requestedGatewayKind?: string | null;
  }): Promise<void> {
    const { ctx, productId, paymentButtonId, lead, telegram, chatId, isBlack, resolveBotId, logTag, remarketingFlowId, remarketingSendId, requestedGatewayKind } = opts;

    if (!this.executeDeps.db || !this.executeDeps.gateway || !this.executeDeps.baseWebhookUrl) {
      console.error(`[${logTag}] Missing deps`);
      return;
    }

    // Gateway padrão (instanciado pelo caller) vs. o escolhido no fluxo.
    // Só reconstrói quando o pedido resolve pra algo diferente do padrão —
    // no caminho comum (nó sem escolha) nada muda.
    let gateway = this.executeDeps.gateway;
    let gatewayKind: GatewayKind = this.executeDeps.gatewayKind ?? "sigilopay";
    if (requestedGatewayKind && this.botPaymentConfig) {
      const resolved = resolveGatewayKind(this.botPaymentConfig, requestedGatewayKind);
      if (resolved !== gatewayKind) {
        gateway = buildGatewayByKind(this.botPaymentConfig, resolved);
        gatewayKind = resolved;
        console.log(`[${logTag}] gateway do nó: ${resolved} (padrão do bot: ${this.executeDeps.gatewayKind})`);
      }
    } else if (requestedGatewayKind && !this.botPaymentConfig) {
      // Deps incompletas: o caller não passou botPaymentConfig, então não dá
      // pra construir o gateway pedido. Segue no padrão (cobrança sai, venda
      // não se perde), mas isso é bug de wiring — precisa aparecer no log.
      console.warn(
        `[${logTag}] nó pediu gateway "${requestedGatewayKind}" mas botPaymentConfig não foi passado ao FlowProcessor — usando o padrão "${gatewayKind}"`,
      );
    }

    const { handleProductPaymentCallback } = await import("./nodes/payment-button.js");

    try {
      const result = await handleProductPaymentCallback(
        ctx,
        this.executeDeps.db,
        gateway,
        this.executeDeps.baseWebhookUrl,
        productId,
        gatewayKind,
        paymentButtonId,
        remarketingFlowId ?? null,
        remarketingSendId ?? null,
      );

      // Auto-delete do Pix: tempo configurado no próprio bloco de pagamento e,
      // sem ele, o padrão do black flow (flows visuais black).
      const deletionDelay = resolveAutoDeleteSeconds(
        ctx.node.data,
        isBlack ? BLACK_DELETE_DELAY_SECONDS : null,
      );
      if (deletionDelay && result.messageIds) {
        const botId = await resolveBotId();
        if (botId) {
          await this.queueMessageDeletion(
            botId,
            telegram.botToken,
            chatId,
            result.messageIds,
            deletionDelay,
          );
        }
      }

      if (result.stateUpdates) {
        lead.state = { ...lead.state, ...result.stateUpdates };
        await this.leadService.updateState(lead.id, result.stateUpdates);
      }
    } catch (error) {
      console.error(`[${logTag}] Error processing payment:`, error);
      await telegram.sendMessage({
        chatId,
        text: "Ocorreu um erro ao processar o pagamento. Tente novamente.",
      });
    }
  }

  /**
   * Execute a flow. If isBlack=true, messages are queued for deletion after 15min (black flow default).
   * If deleteAfterMinutes is provided, overrides isBlack and uses that delay instead.
   *
   * Qualquer uma dessas duas regras vale como PADRÃO do fluxo: um bloco com
   * auto-delete próprio (`node.data.auto_delete_seconds`, configurado no
   * editor) tem precedência sobre ela.
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
    const flowDeletionDelaySeconds =
      deleteAfterMinutes && deleteAfterMinutes > 0
        ? deleteAfterMinutes * 60
        : isBlack
        ? BLACK_DELETE_DELAY_SECONDS
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
    const mediaAssets = await this.loadMediaAssetsForFlow(nodes);
    // Acumula as escolhas (mídia/texto/preço) feitas ao longo desta execução
    // de remarketing — só usado quando !persistPosition (ver bloco de
    // remarketing_variant_sends abaixo).
    const variantAccumulator: NonNullable<NodeResult["variantChoice"]> = {};

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
        mediaAssets,
        remarketingFlowId: persistPosition ? null : flow.id,
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

      // Auto-delete: tempo do próprio bloco (editor) e, sem ele, o padrão do
      // fluxo — black flow (15min) ou deleteAfterMinutes do remarketing.
      const nodeDeletionDelay = resolveAutoDeleteSeconds(node.data, flowDeletionDelaySeconds);
      if (nodeDeletionDelay && result.messageIds) {
        await this.queueMessageDeletion(
          flow.bot_id,
          telegram.botToken,
          chatId,
          result.messageIds,
          nodeDeletionDelay,
        );
      }

      // Rastreio de remarketing: acumula a escolha deste nó (mídia/texto/
      // preço, randomizados ou fixos — variantChoice sempre vem preenchido
      // pelos handlers relevantes) e, ao chegar num ponto terminal desta
      // execução ("wait" = espera clique, null = flow acabou sem próximo
      // nó), grava UMA linha em remarketing_variant_sends com o que foi
      // escolhido ao longo de toda a execução. Escrito em result.stateUpdates
      // ANTES do merge abaixo pra viajar no mesmo round-trip de updateState
      // que já existe — sem round-trip extra no hot path.
      if (!persistPosition) {
        if (result.variantChoice) Object.assign(variantAccumulator, result.variantChoice);
        if (result.nextNodeId === "wait" || result.nextNodeId === null) {
          const { data: sendRow } = await this.db
            .from("remarketing_variant_sends")
            .insert({
              tenant_id: flow.tenant_id,
              bot_id: flow.bot_id,
              remarketing_flow_id: flow.id,
              lead_id: lead.id,
              media_asset_id: variantAccumulator.mediaAssetId ?? null,
              text_variant_index: variantAccumulator.textVariantIndex ?? null,
              bundle_id: variantAccumulator.bundleId ?? null,
            })
            .select("id")
            .single();

          // Correlação de clique (generaliza pra QUALQUER nó o padrão que
          // payment-button.ts já usava só pra si mesmo via
          // ctx.remarketingFlowId, payment-button.ts:265): sem
          // current_flow_id/current_node_id (nunca setados aqui —
          // persistPosition=false), handleCallbackQuery não tinha NENHUM
          // jeito de saber de qual remarketing_flows e de qual nó veio a
          // mensagem que gerou este clique — todo clique em botão comum
          // ("Botões", ou botões extras/"Recusar" de um payment_button)
          // enviado por remarketing morria em silêncio. "wait" grava pra
          // onde o lead está esperando; "null" (flow acabou sem esperar
          // nada) limpa pra não deixar uma referência velha respondendo por
          // um envio que já terminou.
          if (result.nextNodeId === "wait") {
            result.stateUpdates = {
              ...(result.stateUpdates ?? {}),
              pending_remarketing_flow_id: flow.id,
              pending_remarketing_wait_node_id: node.id,
              // sendRow?.id ?? null (em vez de spread condicional): se o
              // insert em remarketing_variant_sends falhar, zera em vez de
              // deixar sobreviver o send_id de uma campanha anterior.
              pending_remarketing_send_id: sendRow?.id ?? null,
            };
          } else {
            result.stateUpdates = {
              ...(result.stateUpdates ?? {}),
              pending_remarketing_flow_id: null,
              pending_remarketing_wait_node_id: null,
              pending_remarketing_send_id: null,
            };
          }
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
          await this.leadService.updateState(lead.id, result.stateUpdates);
        }
      }

      if (result.delaySeconds && result.delaySeconds > 0 && result.nextNodeId) {
        if (persistPosition) {
          if (result.stateUpdates) {
            await this.leadService.updatePositionAndState(
              lead.id,
              flow.id,
              result.nextNodeId,
              result.stateUpdates,
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

        // Comando (/algo) enquanto o lead está parado numa pergunta NÃO é
        // resposta — é ele tentando sair pra outro fluxo. Mesma regra que
        // button/payment_button já aplicavam logo abaixo; sem ela, qualquer
        // comando que não resolvesse fluxo nomeado (tudo menos /start) virava
        // silenciosamente o valor da variável da pergunta.
        if (currentNode?.type === "input" && !messageText.startsWith("/")) {
          const edges = flow.flow_data.edges.filter(
            (e) => e.source === currentNode.id
          );
          const result = handleInputResponse(currentNode, messageText, edges);

          // Resposta reprovada na validação: reprompt e o lead continua parado
          // no mesmo nó (current_node_id não muda), esperando de novo.
          if (result.retryMessage) {
            const sent = await telegram.sendMessage({ chatId, text: result.retryMessage });
            if (isBlack && sent) {
              await this.queueMessageDeletion(
                bot.id,
                telegram.botToken,
                chatId,
                [sent.message_id],
                BLACK_DELETE_DELAY_SECONDS,
              );
            }
            return;
          }

          if (result.stateUpdates) {
            lead.state = { ...lead.state, ...result.stateUpdates };
            await this.leadService.updateState(lead.id, result.stateUpdates);
          }

          if (result.nextNodeId && result.nextNodeId !== "wait") {
            await this.executeFlow(flow, lead, telegram, chatId, result.nextNodeId, isBlack);
          } else if (!result.nextNodeId) {
            // Pergunta respondida mas sem aresta de saída: fim de linha. Solta
            // a posição (mesmo que executeFlow faz ao chegar em nextNodeId
            // null) — senão o lead fica preso neste nó pra sempre, regravando
            // a variável a cada mensagem que mandar.
            await this.leadService.updatePosition(lead.id, null, null);
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

    // Fallback de remarketing: espelha o fallback já existente em
    // handleCallbackQuery (pending_remarketing_flow_id/pending_remarketing_wait_node_id,
    // gravados em executeFlow — bloco `!persistPosition`, sempre que um nó
    // termina em "wait") — mas pro caminho de TEXTO (nó "input"), que nunca
    // foi coberto: execuções de remarketing (persistPosition=false em
    // executeFlow) nunca gravam lead.current_flow_id/current_node_id, então
    // o bloco acima nunca resolve o nó de espera de um flow de remarketing.
    // Sem isso, a resposta digitada pelo lead a um nó Input de remarketing
    // caía direto no trigger-matching abaixo e era descartada silenciosamente
    // (ou, se current_flow_id/current_node_id estivessem "sujos" de um flow
    // REGULAR anterior, era roteada pro nó/variável errada).
    //
    // Só entra em ação quando o bloco acima não tratou nem retornou (sem
    // current_flow_id/current_node_id válidos apontando pra um nó de espera
    // "vivo") — nunca sobrepõe uma resolução de flow regular válida.
    const pendingRemarketingFlowId = (lead.state.pending_remarketing_flow_id as string | null) ?? null;
    const pendingRemarketingWaitNodeId = (lead.state.pending_remarketing_wait_node_id as string | null) ?? null;
    if (pendingRemarketingFlowId && pendingRemarketingWaitNodeId) {
      const remFlow = await this.getRemarketingFlowById(pendingRemarketingFlowId);
      const waitNode = remFlow?.flow_data.nodes.find((n) => n.id === pendingRemarketingWaitNodeId);

      if (remFlow && waitNode?.type === "input" && !messageText.startsWith("/")) {
        const edges = remFlow.flow_data.edges.filter((e) => e.source === waitNode.id);
        const result = handleInputResponse(waitNode, messageText, edges);

        // Igual ao caminho de flow regular: validação reprovada só reprompta,
        // sem avançar nem limpar o pending_remarketing_* (o lead segue
        // esperando exatamente neste nó).
        if (result.retryMessage) {
          await telegram.sendMessage({ chatId, text: result.retryMessage });
          return;
        }

        if (result.stateUpdates) {
          lead.state = { ...lead.state, ...result.stateUpdates };
          await this.leadService.updateState(lead.id, result.stateUpdates);
        }

        if (result.nextNodeId && result.nextNodeId !== "wait") {
          // Continua a execução do flow de remarketing a partir do próximo
          // nó — executeFlow (bloco `!persistPosition`) já cuida de
          // regravar/limpar pending_remarketing_flow_id/wait_node_id quando
          // essa continuação terminar em novo "wait" ou no fim do flow.
          await this.executeFlow(remFlow, lead, telegram, chatId, result.nextNodeId, false, remFlow.deleteAfterMinutes, false);
        } else if (!result.nextNodeId) {
          // Nó Input sem edge de saída configurada: fim de linha — limpa a
          // referência de espera pra não deixar o lead "preso" respondendo
          // pra sempre a um nó que não leva a lugar nenhum.
          const clearPatch = { pending_remarketing_flow_id: null, pending_remarketing_wait_node_id: null };
          lead.state = { ...lead.state, ...clearPatch };
          await this.leadService.updateState(lead.id, clearPatch);
        }
        return;
      }

      // Mesma regra do bloco de flow regular acima: se o lead está esperando
      // clique num nó "button"/"payment_button" de remarketing, texto solto
      // (que não seja comando) não deve furar pro trigger-matching abaixo —
      // só o clique (handleCallbackQuery) resolve esse nó.
      if (remFlow && (waitNode?.type === "button" || waitNode?.type === "payment_button")) {
        if (!messageText.startsWith("/")) {
          console.log(`[flow] Lead ${lead.id} is waiting on remarketing ${waitNode.type} node, ignoring text message`);
          return;
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
        // Gateway é POR TRANSAÇÃO (o nó de pagamento pode escolher um
        // diferente do padrão do bot), então a legenda sai do state gravado
        // por handleProductPaymentCallback junto do QR — não do padrão do bot,
        // que estaria errado sempre que o nó escolhesse outro gateway.
        // Fallback pro padrão cobre cobranças geradas antes desta versão.
        const qrGatewayKind = String(
          lead.state.pending_gateway_kind ?? this.executeDeps.gatewayKind ?? "",
        );
        const isCryptoQr = qrGatewayKind === "nowpayments";
        const msg = await telegram.sendPhoto({
          chatId,
          photo: pixImage,
          caption: isCryptoQr
            ? "📱 QR Code — scan with your crypto wallet"
            : "📱 QR Code Pix — escaneie com o app do seu banco",
        });
        if (isBlack && msg) {
          await this.queueMessageDeletion(bot.id, telegram.botToken, chatId, [msg.message_id], BLACK_DELETE_DELAY_SECONDS);
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
      const remarketingFlowId = (lead.state.pending_remarketing_flow_id as string | null) ?? null;
      const remarketingSendId = (lead.state.pending_remarketing_send_id as string | null) ?? null;

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

      await this.runPaymentCallback({
        ctx,
        productId,
        lead,
        telegram,
        chatId,
        isBlack,
        resolveBotId: async () => {
          if (!lead.current_flow_id) return undefined;
          const typedFlow = await this.getFlowById(lead.current_flow_id);
          return typedFlow?.bot_id;
        },
        logTag: "pay callback",
        remarketingFlowId,
        remarketingSendId,
        // O nó sintético acima não carrega node.data.gateway (só bundle_id
        // sobrevive à reconstrução), então a escolha viaja pelo state —
        // gravada por handlePaymentBundleNode junto de pending_bundle_id.
        requestedGatewayKind: (lead.state.pending_payment_gateway as string | null) ?? null,
      });
      return;
    }

    // Standard button callback: format is "nodeId:value"
    const colonIndex = callbackData.indexOf(":");
    if (colonIndex === -1) return;
    const sourceNodeId = callbackData.substring(0, colonIndex);
    const targetValue = callbackData.substring(colonIndex + 1);
    if (!sourceNodeId) return;

    // Resolução normal: flow "vivo" apontado por lead.current_flow_id
    // (tabela `flows`) — só setado por executeFlow quando persistPosition=true.
    let typedFlow: Flow | null = null;
    if (lead.current_flow_id) {
      typedFlow = await this.getFlowById(lead.current_flow_id);
      if (!typedFlow) {
        console.log(`[callback] Flow ${lead.current_flow_id} not found`);
      }
    }

    // Fallback de remarketing: execuções de remarketing (persistPosition=false
    // em executeFlow) NUNCA gravam lead.current_flow_id/current_node_id — só
    // pending_remarketing_send_id existia antes disso, e só servia pra
    // rastreio de variante, não pra roteamento. Resultado: todo clique em
    // botão comum ("Botões", ou botão extra/"Recusar" de um payment_button)
    // enviado por um flow de remarketing morria aqui — current_flow_id nulo
    // (ignoring acima) ou apontando pra um flow REGULAR antigo sem
    // sourceNodeId (nenhuma edge encontrada mais abaixo).
    //
    // pending_remarketing_flow_id/pending_remarketing_wait_node_id são
    // gravados no fim de todo envio de remarketing que termina em "wait"
    // (executeFlow, bloco `!persistPosition`) — generaliza o padrão que
    // payment-button.ts já usava só pro bundle "pay:". Só entra em ação
    // quando a resolução normal falhou — nunca sobrepõe um flow regular
    // válido (item 4: zero mudança de comportamento pra persistPosition=true).
    let persistPosition = true;
    let deleteAfterMinutesForContinue: number | null | undefined;
    // Só preenchido quando a resolução veio do fallback — runPaymentCallback
    // (botão de pagamento inline abaixo) usa isso pra creditar a compra de
    // volta ao remarketing certo, mesma atribuição que o bundle "pay:" já
    // faz (payment-button.ts:265/426).
    let remarketingFlowIdForPayment: string | null = null;

    if (!typedFlow) {
      const pendingRemarketingFlowId = (lead.state.pending_remarketing_flow_id as string | null) ?? null;
      if (pendingRemarketingFlowId) {
        const remFlow = await this.getRemarketingFlowById(pendingRemarketingFlowId);
        if (remFlow) {
          typedFlow = remFlow;
          persistPosition = false;
          deleteAfterMinutesForContinue = remFlow.deleteAfterMinutes;
          remarketingFlowIdForPayment = pendingRemarketingFlowId;
        } else {
          console.log(`[callback] pending_remarketing_flow_id ${pendingRemarketingFlowId} not found (flow apagado?)`);
        }
      }
    }

    if (!typedFlow) {
      console.log(`[callback] Lead ${lead.id}: nenhum flow resolvido (current_flow_id=${lead.current_flow_id ?? "null"}, pending_remarketing_flow_id=${(lead.state.pending_remarketing_flow_id as string | null) ?? "null"}), ignoring`);
      return;
    }
    // Realiasa pra um `const`: `typedFlow` acima é `let` (reatribuído no
    // fallback de remarketing), e TS não propaga a checagem de não-nulo pra
    // dentro de closures (ex: `resolveBotId` abaixo) quando a variável
    // capturada é mutável. `flow` nunca muda depois daqui.
    const flow = typedFlow;

    // Botão de pagamento inline: dentro de um nó "button" comum, um botão
    // individual pode estar marcado action:"payment" — o clique gera o Pix
    // direto (mesmo handleProductPaymentCallback do nó de pagamento
    // dedicado), sem precisar de um nó separado. Diferente do prefixo
    // "pay:" acima (fluxo de bundle, reconstrói um nó sintético a partir do
    // lead.state), aqui usamos o nó vivo do flow_data — pega sale_type/
    // payment_timeout_minutes reais, sem o gap de reconstrução do outro fluxo.
    const sourceNode = flow.flow_data.nodes.find((n) => n.id === sourceNodeId);
    if (sourceNode?.type === "button") {
      const buttons = (sourceNode.data.buttons ?? []) as Array<{
        id?: string;
        action?: string;
        product_id?: string;
        sale_type?: string;
        gateway?: string;
      }>;
      const btn = buttons.find((b, i) => (b.id ?? `btn_idx_${i}`) === targetValue && b.action === "payment");

      if (btn) {
        const productId = String(btn.product_id ?? "");
        if (!productId) {
          await telegram.sendMessage({ chatId, text: "Erro: nenhum produto configurado neste botão." });
          return;
        }

        // sale_type é configurado por botão (button-config.tsx), não no nó —
        // sobrepõe aqui (nova cópia, nunca muta sourceNode: ele é a mesma
        // referência guardada em flowByIdCache) pra handleProductPaymentCallback
        // gravar a transação com o tipo de venda certo (Análises).
        const ctx: NodeContext = {
          node: { ...sourceNode, data: { ...sourceNode.data, sale_type: btn.sale_type ?? "main" } },
          lead,
          edges: [],
          telegram,
          chatId,
        };

        await this.runPaymentCallback({
          ctx,
          productId,
          paymentButtonId: targetValue,
          lead,
          telegram,
          chatId,
          isBlack,
          resolveBotId: async () => flow.bot_id,
          logTag: "inline payment",
          // Igual ao sale_type: gateway é config POR BOTÃO (button-config.tsx).
          // Aqui o nó vem vivo do flow_data, então lê direto — sem precisar do
          // state, ao contrário do caminho "pay:" do bundle.
          requestedGatewayKind: btn.gateway ?? null,
          // Antes: sempre null (o comentário partia de current_flow_id
          // nunca ser setado pra remarketing — verdade, mas o fallback
          // acima agora resolve `flow` mesmo assim via
          // pending_remarketing_flow_id). Quando a resolução veio do
          // fallback, credita a compra de volta ao remarketing certo —
          // mesma atribuição que o bundle "pay:" já faz
          // (payment-button.ts:265/426).
          remarketingFlowId: remarketingFlowIdForPayment,
          remarketingSendId: persistPosition ? null : ((lead.state.pending_remarketing_send_id as string | null) ?? null),
        });
        return;
      }
    }

    const edges = flow.flow_data.edges.filter((e) => e.source === sourceNodeId);

    // Match por sourceHandle SEMPRE tem prioridade sobre o fallback por
    // target — dois finds separados, não um OR num find só. Com OR, a ORDEM
    // do array decidia: se uma edge SEM handle batendo mas com target ===
    // targetValue viesse antes, no array, da edge certa (sourceHandle ===
    // targetValue), o clique roteava pro destino errado — mesmo o handle
    // certo existindo. Só cai no target-match quando NENHUMA edge do nó tem
    // o handle certo (compat com edges antigas/importadas sem sourceHandle).
    let edge =
      edges.find((e) => e.sourceHandle === targetValue) ??
      edges.find((e) => e.target === targetValue);

    if (!edge && edges.length > 0) {
      // Fallback "primeira edge do nó" — mas nunca escolhe uma edge de
      // pagamento aqui: nem as plain "paid"/"not_paid" do nó de pagamento
      // dedicado (payment-button-node.tsx), nem as "paid:<id>"/"not_paid:<id>"
      // namespaced por botão do botão de pagamento inline. Sem isso, um
      // clique sem match exato (ex: botão de recusa renomeado, "Valor" mal
      // configurado) podia cair acidentalmente na ramificação de pagamento
      // confirmado/não confirmado — sem nenhum Pix ter sido gerado.
      const isPaymentHandle = (h?: string) =>
        h === "paid" || h === "not_paid" || h?.startsWith("paid:") || h?.startsWith("not_paid:");
      const nonPaymentEdges = edges.filter((e) => !isPaymentHandle(e.sourceHandle));
      edge = nonPaymentEdges[0];
    }

    if (edge) {
      console.log(`[callback] Advancing flow from ${sourceNodeId} to ${edge.target}${isBlack ? " [BLACK]" : ""}${persistPosition ? "" : " [REMARKETING]"}`);
      await this.executeFlow(flow, lead, telegram, chatId, edge.target, isBlack, deleteAfterMinutesForContinue, persistPosition);
    } else {
      console.log(`[callback] No edge found for source ${sourceNodeId}, value ${targetValue}${persistPosition ? "" : " [REMARKETING]"}`);
    }
  }
}
