import type { NodeContext, NodeResult } from "./types.js";
import { handleTriggerNode } from "./nodes/trigger.js";
import { handleTextNode } from "./nodes/text.js";
import { handleImageNode } from "./nodes/image.js";
import { handleButtonNode } from "./nodes/button.js";
import { handleDelayNode } from "./nodes/delay.js";
import { handleConditionNode } from "./nodes/condition.js";
import { handleInputNode } from "./nodes/input.js";
import { handleActionNode } from "./nodes/action.js";
import { handleVideoNode } from "./nodes/video.js";
import { handleAudioNode } from "./nodes/audio.js";
import { handlePaymentBundleNode } from "./nodes/payment-button.js";
import { handleUnmappedNode } from "./nodes/unmapped.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentGateway } from "../services/payment-gateway.js";

const handlers: Record<string, (ctx: NodeContext) => Promise<NodeResult>> = {
  trigger: handleTriggerNode,
  text: handleTextNode,
  image: handleImageNode,
  delay: handleDelayNode,
  condition: handleConditionNode,
  input: handleInputNode,
  action: handleActionNode,
  video: handleVideoNode,
  audio: handleAudioNode,
  unmapped: handleUnmappedNode,
};

export interface ExecuteNodeDeps {
  db?: SupabaseClient;
  gateway?: PaymentGateway;
  gatewayKind?: "sigilopay" | "evpay" | "zuckpay" | "nowpayments";
  baseWebhookUrl?: string;
}

export async function executeNode(ctx: NodeContext, deps?: ExecuteNodeDeps): Promise<NodeResult> {
  try {
    if (ctx.node.type === "payment_button") {
      if (!deps?.db || !deps?.gateway || !deps?.baseWebhookUrl) {
        console.error(`[payment_button] Missing deps for node ${ctx.node.id}: db=${!!deps?.db}, gateway=${!!deps?.gateway}, baseWebhookUrl=${!!deps?.baseWebhookUrl}`);
        await ctx.telegram.sendMessage({
          chatId: ctx.chatId,
          text: "Erro interno: pagamento não configurado. Contate o administrador.",
        });
        return { nextNodeId: null };
      }
      return await handlePaymentBundleNode(ctx, deps.db, deps.gateway, deps.baseWebhookUrl);
    }

    // "button" precisa de db só pra tracking (ViewContent quando tem botão
    // action:"payment") — nunca bloqueia o envio da mensagem se faltar.
    if (ctx.node.type === "button") {
      return await handleButtonNode(ctx, deps?.db);
    }

    const handler = handlers[ctx.node.type];
    if (!handler) {
      console.warn(`Unknown node type: ${ctx.node.type}`);
      return { nextNodeId: null };
    }
    return await handler(ctx);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[executeNode] Error in node ${ctx.node.id} (type=${ctx.node.type}):`, errorMsg, error);

    // If user blocked the bot, stop the flow silently — no point sending error messages
    if (errorMsg.includes("bot was blocked by the user") || errorMsg.includes("Forbidden")) {
      return { nextNodeId: null, blocked: true };
    }

    try {
      await ctx.telegram.sendMessage({
        chatId: ctx.chatId,
        text: `⚠️ Erro no nó "${ctx.node.type}": ${errorMsg}`,
      });
    } catch {
      // ignore telegram send error
    }
    return { nextNodeId: null };
  }
}
