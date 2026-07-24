export type CloneMediaKind =
  | "photo"
  | "video"
  | "document"
  | "audio"
  | "sticker"
  | "animation";

export type MediaPlan =
  | { kind: "text" }
  | { kind: "media"; mediaKind: CloneMediaKind }
  | { kind: "poll" }
  | { kind: "skip"; reason: string };

export interface PlanInput {
  /** className da Api.Message.media, ou null quando não há mídia. */
  mediaClassName: string | null;
  /** classNames dos atributos do documento, quando a mídia é documento. */
  documentAttributeClassNames: string[];
  hasText: boolean;
  copyPolls: boolean;
}

/**
 * Motivos de skip são strings estáveis: aparecem no relatório da UI e nos
 * testes. Não renomear sem migrar clone_message_map.reason.
 */
const SKIP_BY_MEDIA: Record<string, string> = {
  MessageMediaGame: "media_game",
  MessageMediaInvoice: "media_invoice",
  MessageMediaGiveaway: "media_giveaway",
  MessageMediaGiveawayResults: "media_giveaway",
  MessageMediaPaidMedia: "media_paid",
  MessageMediaStory: "media_story",
  MessageMediaGeoLive: "media_geo_live",
  MessageMediaDice: "media_dice",
  MessageMediaUnsupported: "media_unsupported",
};

function documentKind(attributeClassNames: string[]): CloneMediaKind {
  if (attributeClassNames.includes("DocumentAttributeSticker")) return "sticker";
  if (attributeClassNames.includes("DocumentAttributeAnimated")) return "animation";
  if (attributeClassNames.includes("DocumentAttributeVideo")) return "video";
  if (attributeClassNames.includes("DocumentAttributeAudio")) return "audio";
  return "document";
}

export function planForMessage(input: PlanInput): MediaPlan {
  const { mediaClassName, documentAttributeClassNames, hasText, copyPolls } = input;

  if (mediaClassName === null) {
    return hasText ? { kind: "text" } : { kind: "skip", reason: "empty_message" };
  }

  // Preview de link não é mídia: é gerado pelo servidor a partir do texto.
  // Enviar só o texto reproduz o post com fidelidade ~100%.
  if (mediaClassName === "MessageMediaWebPage") return { kind: "text" };

  if (mediaClassName === "MessageMediaPhoto") return { kind: "media", mediaKind: "photo" };

  if (mediaClassName === "MessageMediaDocument") {
    return { kind: "media", mediaKind: documentKind(documentAttributeClassNames) };
  }

  if (mediaClassName === "MessageMediaPoll") {
    return copyPolls ? { kind: "poll" } : { kind: "skip", reason: "poll_disabled" };
  }

  const known = SKIP_BY_MEDIA[mediaClassName];
  if (known) return { kind: "skip", reason: known };

  // Desconhecido: pular explicitamente. O utils do gramjs mapeia mídia que
  // não reconhece para InputMediaEmpty, o que enviaria uma mensagem vazia
  // sem avisar ninguém.
  return { kind: "skip", reason: "media_unknown" };
}
