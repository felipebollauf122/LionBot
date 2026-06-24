import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramApi } from "../telegram/api.js";
import type { FlowNode, FlowEdge, Lead } from "./types.js";
import type { LeadService } from "../services/lead-service.js";
import type { PaymentGateway } from "../services/payment-gateway.js";
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
export declare class FlowProcessor {
    private db;
    private leadService;
    private delayQueue;
    private executeDeps;
    constructor(db: SupabaseClient, leadService: LeadService, delayQueue: DelayQueue, deps?: {
        gateway?: PaymentGateway;
        gatewayKind?: "sigilopay" | "evpay";
        baseWebhookUrl?: string;
    });
    /**
     * Fetch a flow by ID, using in-memory cache to avoid repeated DB queries.
     */
    private getFlowById;
    /**
     * Fetch all active flows for a bot, using in-memory cache.
     */
    private getActiveFlows;
    /**
     * Fetch a named flow (e.g. _visual_flow, _black_flow) for a bot.
     * Always falls back to a fresh DB query if not found in cache —
     * critical for _black_flow which must never be silently skipped.
     */
    private getNamedFlow;
    /**
     * Queue a message for deletion after `delayMinutes` minutes.
     */
    private queueMessageDeletion;
    /**
     * Execute a flow. If isBlack=true, messages are queued for deletion after 15min (black flow default).
     * If deleteAfterMinutes is provided, overrides isBlack and uses that delay instead.
     */
    executeFlow(flow: Flow, lead: Lead, telegram: TelegramApi, chatId: number, startNodeId?: string, isBlack?: boolean, deleteAfterMinutes?: number | null, persistPosition?: boolean): Promise<{
        blocked?: boolean;
    }>;
    /**
     * Handle /start command with flow routing.
     * Finds the named flow (_visual_flow or _black_flow) and executes it.
     * Sets active_flow_name on the lead.
     */
    handleStartCommand(bot: {
        id: string;
        tenant_id: string;
        telegram_token: string;
    }, lead: Lead, telegram: TelegramApi, chatId: number, messageText: string, flowName: string): Promise<void>;
    handleIncomingMessage(bot: {
        id: string;
        tenant_id: string;
        telegram_token: string;
    }, lead: Lead, telegram: TelegramApi, chatId: number, messageText: string): Promise<void>;
    handleCallbackQuery(bot: {
        id: string;
        tenant_id: string;
    }, lead: Lead, telegram: TelegramApi, chatId: number, callbackData: string): Promise<void>;
}
export {};
