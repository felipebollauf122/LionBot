import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

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
export async function loadFeed(
  botId: string,
): Promise<{ channel: FeedChannel; messages: FeedMessage[] } | null> {
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
    .select("id,title,avatar_url,subscribers_label,is_verified")
    .eq("bot_id", botId)
    .eq("is_active", true)
    .single();

  if (!canal) return null;

  const { data: linhas } = await supabase
    .from("social_proof_messages")
    .select(
      "id,sender_name,sender_avatar_url,content_text,media_url,media_type,offset_seconds,views_count",
    )
    .eq("channel_id", canal.id)
    .eq("is_active", true)
    // created_at desempata: `position` pode repetir (nada no banco impede), e
    // ordenar só por ela deixa o Postgres livre pra devolver ordem diferente a
    // cada requisição — inclusive ordem diferente da que o tenant vê no
    // composer. O mesmo desempate está em lib/actions/social-proof-actions.ts.
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return {
    channel: {
      title: canal.title,
      avatarUrl: canal.avatar_url,
      subscribersLabel: canal.subscribers_label,
      isVerified: canal.is_verified,
    },
    messages: (linhas ?? []).map((r) => ({
      id: r.id,
      senderName: r.sender_name,
      senderAvatarUrl: r.sender_avatar_url,
      contentText: r.content_text,
      mediaUrl: r.media_url,
      mediaType: r.media_type,
      offsetSeconds: r.offset_seconds,
      viewsCount: r.views_count,
    })),
  };
}
