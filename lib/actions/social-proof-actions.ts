"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
// Os tipos vivem em types.ts: um módulo "use server" só pode exportar funções async.
import type { ActionResult, ChannelInput, MessageInput } from "@/lib/social-proof/types";
import { nextPosition } from "@/lib/social-proof/position";

export async function getSocialProof(
  botId: string,
): Promise<{ channel: SocialProofChannel | null; messages: SocialProofMessage[] }> {
  const supabase = await createClient();

  const { data: channel } = await supabase
    .from("social_proof_channels")
    .select("*")
    .eq("bot_id", botId)
    .maybeSingle();

  if (!channel) return { channel: null, messages: [] };

  const { data: messages } = await supabase
    .from("social_proof_messages")
    .select("*")
    .eq("channel_id", (channel as SocialProofChannel).id)
    // Mesmo desempate de lib/social-proof/feed.ts: sem created_at, `position`
    // repetida deixa a ordem do composer divergir da que o lead enxerga.
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return {
    channel: channel as SocialProofChannel,
    messages: (messages ?? []) as SocialProofMessage[],
  };
}

/**
 * tenant_id a gravar nas linhas novas.
 *
 * Normalmente é o próprio usuário. Quando um admin da plataforma está mexendo
 * no bot de um cliente, é o tenant DO BOT — senão as linhas nasceriam com o
 * tenant errado e sumiriam da vista do dono. Mesmo desvio de
 * lib/actions/media-actions.ts:22-29.
 */
async function tenantDoBot(botId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (await isAdmin()) {
    const { data: bot } = await supabase.from("bots").select("tenant_id").eq("id", botId).single();
    return (bot?.tenant_id as string | undefined) ?? null;
  }

  // Não-admin: RLS já garante que ele só enxerga o próprio bot.
  const { data: bot } = await supabase.from("bots").select("tenant_id").eq("id", botId).single();
  return (bot?.tenant_id as string | undefined) ?? null;
}

export async function saveChannel(botId: string, input: ChannelInput): Promise<ActionResult> {
  if (input.title.trim() === "") {
    return { ok: false, error: "O nome do canal não pode ficar vazio." };
  }

  const tenantId = await tenantDoBot(botId);
  if (!tenantId) return { ok: false, error: "Bot não encontrado." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_proof_channels")
    .upsert({ tenant_id: tenantId, bot_id: botId, ...input }, { onConflict: "bot_id" });

  if (error) return { ok: false, error: `Não deu pra salvar o canal: ${error.message}` };

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}

export async function saveMessage(botId: string, input: MessageInput): Promise<ActionResult> {
  const temTexto = (input.content_text ?? "").trim() !== "";
  const temMidia = (input.media_url ?? "").trim() !== "";

  if (!temTexto && !temMidia) {
    return { ok: false, error: "A mensagem precisa de texto ou mídia." };
  }
  if (temMidia && input.media_type === null) {
    return { ok: false, error: "Escolha se a mídia é imagem ou vídeo." };
  }
  if (input.sender_name.trim() === "") {
    return { ok: false, error: "O nome do remetente não pode ficar vazio." };
  }
  if (input.offset_seconds < 0) {
    return { ok: false, error: "O tempo atrás não pode ser negativo." };
  }

  const tenantId = await tenantDoBot(botId);
  if (!tenantId) return { ok: false, error: "Bot não encontrado." };

  const supabase = await createClient();
  const { data: channel } = await supabase
    .from("social_proof_channels")
    .select("id")
    .eq("bot_id", botId)
    .maybeSingle();

  if (!channel) return { ok: false, error: "Salve os dados do canal antes de criar mensagens." };

  const channelId = (channel as { id: string }).id;

  const row = {
    tenant_id: tenantId,
    bot_id: botId,
    channel_id: channelId,
    sender_name: input.sender_name,
    sender_avatar_url: input.sender_avatar_url,
    content_text: temTexto ? input.content_text : null,
    media_url: temMidia ? input.media_url : null,
    media_type: temMidia ? input.media_type : null,
    offset_seconds: input.offset_seconds,
    views_count: input.views_count,
    is_active: true,
  };

  if (input.id) {
    // `.eq("bot_id", botId)` além do id: esta é uma Server Action, invocável
    // direto por qualquer sessão autenticada, e sem o escopo por bot a única
    // barreira contra editar a mensagem de outro tenant seria a RLS.
    // `position` fica de fora do update de propósito — quem define a ordem é o
    // insert (max+1); um update não pode reescrevê-la a partir do cliente.
    const { data, error } = await supabase
      .from("social_proof_messages")
      .update(row)
      .eq("id", input.id)
      .eq("bot_id", botId)
      .select("id");

    if (error) return { ok: false, error: `Não deu pra salvar a mensagem: ${error.message}` };
    // Sem linha afetada o supabase-js NÃO devolve error — a RLS pode ter
    // barrado 100% das linhas e a action responderia { ok: true }, sucesso
    // silencioso. A contagem é a única prova de que algo mudou de verdade.
    if (!data || data.length === 0) {
      return { ok: false, error: "Mensagem não encontrada neste bot (ou sem permissão pra editar)." };
    }
  } else {
    // Posição calculada AQUI, nunca no cliente: o composer usava
    // `messages.length + 1`, que colide depois de apagar uma mensagem do meio
    // e recarregar a página (3 mensagens → apaga a do meio → length+1 volta a
    // ser 3, valor que já existe).
    const { error } = await supabase
      .from("social_proof_messages")
      .insert({ ...row, position: await proximaPosicao(channelId) });

    if (error) return { ok: false, error: `Não deu pra salvar a mensagem: ${error.message}` };
  }

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}

/**
 * Próxima `position` livre de um canal: max(position) + 1.
 *
 * Canal vazio (ou leitura barrada) começa em 1, mesma base que o composer
 * usava. A lógica vive em lib/social-proof/position.ts pra poder ser testada —
 * um módulo "use server" só exporta função async, então nada de helper puro
 * aqui dentro.
 */
async function proximaPosicao(channelId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("social_proof_messages")
    .select("position")
    .eq("channel_id", channelId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  return nextPosition((data as { position: number } | null)?.position ?? null);
}

export async function deleteMessage(messageId: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();
  // Mesmo raciocínio do update: escopo por bot além do id (Server Action é
  // invocável direto), e contagem de linhas afetadas porque delete que não
  // pegou nada não vira `error` no supabase-js — viraria { ok: true } falso.
  const { data, error } = await supabase
    .from("social_proof_messages")
    .delete()
    .eq("id", messageId)
    .eq("bot_id", botId)
    .select("id");

  if (error) return { ok: false, error: `Não deu pra apagar: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, error: "Mensagem não encontrada neste bot (ou sem permissão pra apagar)." };
  }

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}
