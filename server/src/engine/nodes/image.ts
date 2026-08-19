import type { NodeContext, NodeResult } from "../types.js";
import { findNextNodeId } from "./text.js";
import { pickRandomIndex } from "./variant-pick.js";

// Aceita: URL http(s) OU file_id do Telegram (alfanumérico+hifens+underscores,
// geralmente ~20+ chars). Rejeita string vazia, "undefined"/"null", texto puro
// (ex: "imagem"), e qualquer coisa que vai dar 'Wrong string length' no
// sendPhoto.
function isValidPhotoRef(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v === "undefined" || v === "null") return false;
  if (/^https?:\/\/\S+/i.test(v)) return true;
  // file_id típico: 20+ chars, base64url-ish
  if (/^[A-Za-z0-9_-]{20,}$/.test(v)) return true;
  return false;
}

export async function handleImageNode(ctx: NodeContext): Promise<NodeResult> {
  let photo = String(ctx.node.data.image_url ?? ctx.node.data.photo ?? "");
  let mediaAssetId: string | null = null;

  // Biblioteca de mídia: randomize=true + media_asset_ids sorteiam 1 asset
  // ativo do bot a cada envio, em vez do image_url fixo. Cai de volta pro
  // campo fixo se a lista estiver vazia ou nenhum id resolver (asset
  // desativado/excluído após o node ser configurado).
  if (ctx.node.data.randomize === true && ctx.mediaAssets) {
    const configuredIds = Array.isArray(ctx.node.data.media_asset_ids) ? ctx.node.data.media_asset_ids : [];
    const candidates = configuredIds
      .map((id) => String(id))
      .filter((id) => ctx.mediaAssets?.get(id)?.kind === "image");
    if (candidates.length > 0) {
      const pickedId = candidates[pickRandomIndex(candidates.length)];
      const asset = ctx.mediaAssets.get(pickedId);
      if (asset) {
        photo = asset.url;
        mediaAssetId = pickedId;
      }
    }
  }

  const caption = ctx.node.data.caption ? String(ctx.node.data.caption) : undefined;
  const next = findNextNodeId(ctx.edges, ctx.node.id);

  if (!isValidPhotoRef(photo)) {
    console.warn(
      `[image-node] node=${ctx.node.id} pulado: image_url inválido (valor=${JSON.stringify(photo)}). Configure uma URL https:// ou um file_id válido no flow editor.`,
    );
    return { nextNodeId: next };
  }

  const sent = await ctx.telegram.sendPhoto({
    chatId: ctx.chatId,
    photo,
    caption,
  });

  return {
    nextNodeId: next,
    messageIds: sent ? [sent.message_id] : undefined,
    variantChoice: mediaAssetId ? { mediaAssetId } : undefined,
  };
}
