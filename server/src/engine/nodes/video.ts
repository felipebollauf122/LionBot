import type { NodeContext, NodeResult } from "../types.js";
import { findNextNodeId } from "./text.js";
import { pickRandomIndex } from "./variant-pick.js";

function isValidMediaRef(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v === "undefined" || v === "null") return false;
  if (/^https?:\/\/\S+/i.test(v)) return true;
  if (/^[A-Za-z0-9_-]{20,}$/.test(v)) return true;
  return false;
}

export async function handleVideoNode(ctx: NodeContext): Promise<NodeResult> {
  let video = String(ctx.node.data.video_url ?? "");
  let mediaAssetId: string | null = null;

  if (ctx.node.data.randomize === true && ctx.mediaAssets) {
    const configuredIds = Array.isArray(ctx.node.data.media_asset_ids) ? ctx.node.data.media_asset_ids : [];
    const candidates = configuredIds
      .map((id) => String(id))
      .filter((id) => ctx.mediaAssets?.get(id)?.kind === "video");
    if (candidates.length > 0) {
      const pickedId = candidates[pickRandomIndex(candidates.length)];
      const asset = ctx.mediaAssets.get(pickedId);
      if (asset) {
        video = asset.url;
        mediaAssetId = pickedId;
      }
    }
  }

  const caption = ctx.node.data.caption ? String(ctx.node.data.caption) : undefined;
  const next = findNextNodeId(ctx.edges, ctx.node.id);

  if (!isValidMediaRef(video)) {
    console.warn(
      `[video-node] node=${ctx.node.id} pulado: video_url inválido (valor=${JSON.stringify(video)}).`,
    );
    return { nextNodeId: next };
  }

  const sent = await ctx.telegram.sendVideo({
    chatId: ctx.chatId,
    video,
    caption,
  });

  return {
    nextNodeId: next,
    messageIds: sent ? [sent.message_id] : undefined,
    variantChoice: mediaAssetId ? { mediaAssetId } : undefined,
  };
}
