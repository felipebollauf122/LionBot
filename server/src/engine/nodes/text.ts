import type { NodeContext, NodeResult } from "../types.js";
import { pickRandomIndex } from "./variant-pick.js";

function interpolate(template: string, lead: NodeContext["lead"]): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in lead) {
      return String((lead as unknown as Record<string, unknown>)[key] ?? "");
    }
    if (lead.state && key in lead.state) {
      return String(lead.state[key] ?? "");
    }
    return "";
  });
}

export function findNextNodeId(edges: NodeContext["edges"], currentNodeId: string, handle?: string): string | null {
  const edge = edges.find(
    (e) => e.source === currentNodeId && (handle ? e.sourceHandle === handle : true)
  );
  return edge?.target ?? null;
}

export async function handleTextNode(ctx: NodeContext): Promise<NodeResult> {
  // Variação de texto: sorteia 1 de N variantes configuradas (biblioteca de
  // remarketing). Sem variantes configuradas, cai no campo fixo de sempre.
  const variants = (Array.isArray(ctx.node.data.text_variants) ? ctx.node.data.text_variants : [])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  const variantIndex = variants.length > 0 ? pickRandomIndex(variants.length) : null;
  const template = variantIndex !== null ? variants[variantIndex] : String(ctx.node.data.text ?? "");
  const text = interpolate(template, ctx.lead);

  const sent = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text,
  });

  return {
    nextNodeId: findNextNodeId(ctx.edges, ctx.node.id),
    messageIds: sent ? [sent.message_id] : undefined,
    variantChoice: variantIndex !== null ? { textVariantIndex: variantIndex } : undefined,
  };
}
