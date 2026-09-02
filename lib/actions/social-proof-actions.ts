"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
// Os tipos vivem em types.ts: um módulo "use server" só pode exportar funções async.
import type { ActionResult, ChannelInput, MessageInput } from "@/lib/social-proof/types";
import { nextPosition } from "@/lib/social-proof/position";
import { validateMessage } from "@/lib/social-proof/validate-message";

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
  if (input.unread_badge < 0) {
    return { ok: false, error: "O contador de não lidas não pode ser negativo." };
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
  const valido = validateMessage(input);
  if (!valido.ok) return valido;

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
    sender_kind: input.sender_kind,
    sender_name: input.sender_name,
    sender_avatar_url: input.sender_avatar_url,
    kind: input.kind,
    content_text: (input.content_text ?? "").trim() === "" ? null : input.content_text,
    media: input.media,
    reactions: input.reactions,
    reply_to_id: input.reply_to_id,
    display_time: input.display_time,
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

/**
 * Copia uma mensagem para o fim do feed.
 *
 * Lê a linha com o client sob RLS — se o tenant não puder ver, não pode
 * duplicar, e a checagem sai de graça. A cópia nasce com position nova e SEM
 * herdar reply_to_id: uma resposta duplicada apontaria para a mesma citação em
 * dois lugares do feed, o que não acontece num canal real.
 */
export async function duplicateMessage(messageId: string, botId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: origem } = await supabase
    .from("social_proof_messages")
    .select(
      "tenant_id,bot_id,channel_id,sender_kind,sender_name,sender_avatar_url,kind,content_text,media,reactions,display_time,offset_seconds,views_count",
    )
    .eq("id", messageId)
    .eq("bot_id", botId)
    .maybeSingle();

  if (!origem) {
    return { ok: false, error: "Mensagem não encontrada neste bot (ou sem permissão)." };
  }

  const { error } = await supabase.from("social_proof_messages").insert({
    ...origem,
    reply_to_id: null,
    is_active: true,
    position: await proximaPosicao(origem.channel_id as string),
  });

  if (error) return { ok: false, error: `Não deu pra duplicar: ${error.message}` };

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}

/**
 * Fixa uma mensagem no topo do canal, ou desafixa com `null`.
 *
 * O `.eq("bot_id", botId)` na leitura impede fixar mensagem de outro bot mesmo
 * que o id vaze — a RLS cobriria, mas Server Action é invocável direto e a
 * defesa em profundidade custa uma linha.
 */
export async function setPinnedMessage(
  botId: string,
  messageId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();

  if (messageId !== null) {
    const { data: alvo } = await supabase
      .from("social_proof_messages")
      .select("id")
      .eq("id", messageId)
      .eq("bot_id", botId)
      .maybeSingle();

    if (!alvo) {
      return { ok: false, error: "Mensagem não encontrada neste bot (ou sem permissão)." };
    }
  }

  const { data, error } = await supabase
    .from("social_proof_channels")
    .update({ pinned_message_id: messageId })
    .eq("bot_id", botId)
    .select("id");

  if (error) return { ok: false, error: `Não deu pra fixar: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, error: "Canal não encontrado (ou sem permissão)." };
  }

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}

/**
 * Grava a ordem nova depois de arrastar-e-soltar.
 *
 * As posições são reescritas como 1..N em vez de trocar duas: depois de vários
 * arrastes as posições ficam com buracos, e renumerar mantém a lista estável e
 * previsível. Cada update leva `.eq("bot_id", botId)` — a lista de ids vem do
 * cliente e não pode ser confiada sozinha.
 */
export async function reorderMessages(
  botId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  if (orderedIds.length === 0) return { ok: true };

  const supabase = await createClient();

  // Confere a lista ANTES de escrever qualquer coisa. Uma lista parcial, ou com
  // id que não é deste bot, faria as posições 1..N colidirem com as posições
  // antigas das mensagens deixadas de fora — e o loop abaixo não é transacional,
  // então metade já estaria gravada quando o problema aparecesse.
  //
  // A leitura passa pela RLS, então `existentes` já é só o que o tenant enxerga.
  const { data: existentes, error: erroLeitura } = await supabase
    .from("social_proof_messages")
    .select("id")
    .eq("bot_id", botId);

  if (erroLeitura) {
    return { ok: false, error: `Não deu pra ler as mensagens: ${erroLeitura.message}` };
  }

  const doBot = new Set((existentes ?? []).map((m) => m.id as string));
  const permutacaoCompleta =
    orderedIds.length === doBot.size && orderedIds.every((id) => doBot.has(id));

  if (!permutacaoCompleta) {
    return {
      ok: false,
      error: "A lista de mensagens mudou. Recarregue a página e tente de novo.",
    };
  }

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("social_proof_messages")
      .update({ position: i + 1 })
      .eq("id", orderedIds[i])
      .eq("bot_id", botId);

    if (error) return { ok: false, error: `Não deu pra reordenar: ${error.message}` };
  }

  revalidatePath(`/dashboard/bots/${botId}/prova-social`);
  return { ok: true };
}
