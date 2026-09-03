import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";
import { normalizeMedia } from "@/lib/social-proof/media";
import { normalizeReactions } from "@/lib/social-proof/reactions";

export interface LoadedFeed {
  channel: FeedChannel;
  messages: FeedMessage[];
  pinnedText: string;
  /** Foto da mensagem fixada, para a miniatura da barra. null sem foto. */
  pinnedMediaUrl: string | null;
}

/**
 * Lê o feed público de um bot.
 *
 * Service-role porque o lead não tem sessão Supabase — RLS não teria em quem se
 * apoiar. As colunas são enumeradas uma a uma, nunca select("*"): assim uma
 * coluna sensível acrescentada no futuro não vaza por acidente pro Mini App.
 *
 * Mesmo padrão de app/go/route.ts: o cliente é criado inline, sem helper
 * compartilhado.
 */
export async function loadFeed(botId: string): Promise<LoadedFeed | null> {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Bot desativado apaga TODAS as superfícies públicas — app/t/page.tsx e
  // app/go/route.ts já checam is_active, e sem isto o Mini App era a única que
  // continuava servindo conteúdo de um bot que o tenant desligou.
  const { data: bot } = await supabase
    .from("bots")
    .select("id")
    .eq("id", botId)
    .eq("is_active", true)
    .single();

  if (!bot) return null;

  const { data: canal } = await supabase
    .from("social_proof_channels")
    .select(
      "id,title,avatar_url,subscribers_label,is_verified,owner_name,owner_avatar_url,owner_username,unread_badge,pinned_message_id",
    )
    .eq("bot_id", botId)
    .eq("is_active", true)
    .single();

  if (!canal) return null;

  const { data: linhas } = await supabase
    .from("social_proof_messages")
    .select(
      "id,sender_kind,sender_name,sender_avatar_url,kind,content_text,media,media_url,media_type,reactions,reply_to_id,display_time,offset_seconds,views_count",
    )
    .eq("channel_id", canal.id)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const brutas = linhas ?? [];

  // A citação da resposta é resolvida aqui, no servidor, contra as mensagens já
  // carregadas. Uma consulta por resposta seria N+1, e o alvo quase sempre está
  // no mesmo feed.
  const porId = new Map(brutas.map((r) => [r.id as string, r]));

  const messages: FeedMessage[] = brutas.map((r) => {
    const alvo = r.reply_to_id ? porId.get(r.reply_to_id as string) : undefined;
    return {
      id: r.id,
      senderKind: r.sender_kind === "owner" ? "owner" : "member",
      senderName: r.sender_name,
      senderAvatarUrl: r.sender_avatar_url,
      kind: r.kind,
      contentText: r.content_text,
      media: normalizeMedia(r.media, r.media_url, r.media_type),
      reactions: normalizeReactions(r.reactions),
      replyToText: alvo ? (alvo.content_text as string | null) : null,
      replyToSender: alvo
        ? alvo.sender_kind === "owner"
          ? canal.owner_name || canal.title
          : (alvo.sender_name as string)
        : null,
      offsetSeconds: r.offset_seconds,
      displayTime: r.display_time,
      viewsCount: r.views_count,
    };
  });

  const fixadaLinha = canal.pinned_message_id
    ? porId.get(canal.pinned_message_id as string)
    : undefined;
  const fixada = (fixadaLinha?.content_text as string | null) ?? "";
  const fixadaMidia = fixadaLinha
    ? normalizeMedia(fixadaLinha.media, fixadaLinha.media_url, fixadaLinha.media_type)
    : [];

  return {
    channel: {
      title: canal.title,
      avatarUrl: canal.avatar_url,
      subscribersLabel: canal.subscribers_label,
      isVerified: canal.is_verified,
      ownerName: canal.owner_name,
      ownerAvatarUrl: canal.owner_avatar_url,
      ownerUsername: canal.owner_username,
      unreadBadge: canal.unread_badge,
    },
    messages,
    pinnedText: fixada,
    pinnedMediaUrl: fixadaMidia.find((m) => m.type === "photo")?.url ?? null,
  };
}
