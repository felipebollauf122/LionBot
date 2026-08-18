import type { NodeContext, NodeResult } from "../types.js";
import { findNextNodeId } from "./text.js";

/**
 * Nó gerado só pela clonagem de fluxo de bot (server/src/services/mtproto/
 * bot-clone/transcript-to-flow.ts) — representa conteúdo que não deu pra
 * mapear automaticamente pro vocabulário de nós do EagleBot: botão pulado
 * pelo payment-guard ("skipped_branch"), botão nunca clicado até o job
 * terminar ("not_explored"), ou mídia de tipo não suportado pelo engine
 * ("unsupported_media"). Nunca aparece na paleta de "arrastar novo nó" do
 * editor — só existe como saída de um fluxo clonado, pra revisão manual
 * antes de ativar (fluxos clonados sempre entram com is_active=false).
 */
export async function handleUnmappedNode(ctx: NodeContext): Promise<NodeResult> {
  const kind = String(ctx.node.data.kind ?? "unmapped");
  const originalLabel = ctx.node.data.original_label ? String(ctx.node.data.original_label) : null;
  const mediaKind = ctx.node.data.media_kind ? String(ctx.node.data.media_kind) : null;
  const caption = ctx.node.data.caption ? String(ctx.node.data.caption) : "";

  let text: string;
  if (kind === "skipped_branch" || kind === "not_explored") {
    text = `⚠️ Conteúdo não migrado automaticamente${originalLabel ? ` (botão original: "${originalLabel}")` : ""}. Configure manualmente antes de ativar este fluxo.`;
  } else if (kind === "unsupported_media") {
    text = [`⚠️ Mídia do tipo "${mediaKind ?? "desconhecido"}" não suportada — configure manualmente.`, caption].filter(Boolean).join("\n\n");
  } else {
    text = "⚠️ Conteúdo não migrado automaticamente. Configure manualmente antes de ativar este fluxo.";
  }

  const sent = await ctx.telegram.sendMessage({ chatId: ctx.chatId, text });

  return {
    nextNodeId: findNextNodeId(ctx.edges, ctx.node.id),
    messageIds: sent ? [sent.message_id] : undefined,
  };
}
