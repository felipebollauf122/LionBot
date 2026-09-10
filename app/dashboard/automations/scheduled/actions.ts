"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { accumulateSchedule } from "@/lib/composer/schedule";
import { validateMessage } from "@/lib/social-proof/validate-message";
import { nextPosition } from "@/lib/social-proof/position";
import type { ActionResult, MessageInput } from "@/lib/social-proof/types";
import type { ScheduledCampaign, ScheduledMessage } from "@/lib/types/database";

function rota(campaignId: string): string {
  return `/dashboard/automations/scheduled/${campaignId}`;
}

/**
 * Roda `corpo` atrás da checagem de acesso, sem deixar NADA escapar como
 * `throw`.
 *
 * `requireAutomationsAccess()` lança `Error("Unauthorized")` — e um erro
 * lançado de dentro de uma Server Action é apagado pelo Next em produção,
 * chegando ao usuário como uma string genérica em inglês (já mordeu este
 * projeto antes). Faltar a assinatura de automações é uma recusa PREVISTA,
 * não uma exceção, então vira dado como qualquer outra. A checagem continua
 * sendo a primeira coisa que cada action faz — só muda como a recusa viaja,
 * não quando ela é conferida.
 *
 * O segundo `catch` é rede de segurança pra qualquer exceção verdadeiramente
 * inesperada dentro do corpo (as recusas previstas — campanha não
 * encontrada, RLS barrando, validação — já voltam como `return`, nunca
 * chegam a lançar); loga com o nome da action pra não perder o rastro no
 * servidor, e devolve uma mensagem honesta mas sem vazar detalhe interno.
 */
async function comGuarda(acao: string, corpo: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    await requireAutomationsAccess();
  } catch {
    return { ok: false, error: "Seu plano não inclui as automações do Telegram." };
  }

  try {
    return await corpo();
  } catch (err) {
    console.error(`[${acao}] erro inesperado:`, err);
    return { ok: false, error: "Não foi possível concluir a ação. Tente de novo." };
  }
}

/**
 * Campanha vazia, pra quem quer montar a sequência à mão em vez de partir de
 * um clone. Não devolve `ActionResult` porque quem chama precisa do id pra
 * navegar — mas continua sem lançar, pelo mesmo motivo de comGuarda.
 */
export async function createEmptyCampaign(
  actingTenantId?: string,
): Promise<{ ok: true; campaignId: string } | { ok: false; error: string }> {
  try {
    await requireAutomationsAccess();
  } catch {
    return { ok: false, error: "Seu plano não inclui as automações do Telegram." };
  }

  try {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("mtproto_scheduled_campaigns")
      .insert({ tenant_id: tenantId, name: "Nova campanha", status: "draft" })
      .select("id")
      .single();
    if (error) return { ok: false, error: `Não deu pra criar a campanha: ${error.message}` };

    revalidatePath("/dashboard/automations");
    return { ok: true, campaignId: data.id as string };
  } catch (err) {
    console.error("[createEmptyCampaign] erro inesperado:", err);
    return { ok: false, error: "Não foi possível criar a campanha. Tente de novo." };
  }
}

export async function getScheduledCampaign(campaignId: string): Promise<{
  campaign: ScheduledCampaign | null;
  messages: ScheduledMessage[];
}> {
  // Mesmo raciocínio de comGuarda, adaptado pro shape de leitura: sem
  // assinatura ou erro inesperado, degrada pro "vazio" em vez de lançar —
  // é o que uma campanha inexistente já devolve algumas linhas abaixo.
  try {
    await requireAutomationsAccess();
  } catch {
    return { campaign: null, messages: [] };
  }

  try {
    const supabase = await createClient();
    const { data: campaign } = await supabase
      .from("mtproto_scheduled_campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign) return { campaign: null, messages: [] };

    const { data: messages } = await supabase
      .from("mtproto_scheduled_messages")
      .select("*")
      .eq("campaign_id", campaignId)
      // Mesmo desempate da 071: sem created_at, position repetida faz a ordem da
      // tela divergir da ordem de envio.
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    return {
      campaign: campaign as ScheduledCampaign,
      messages: (messages ?? []) as ScheduledMessage[],
    };
  } catch (err) {
    console.error("[getScheduledCampaign] erro inesperado:", err);
    return { campaign: null, messages: [] };
  }
}

/**
 * tenant_id a gravar nas mensagens novas: o dono da campanha. Mesmo
 * raciocínio de tenantDoBot em lib/actions/social-proof-actions.ts — a
 * leitura passa pela RLS, então só enxerga (e só resolve) quem pode mesmo
 * mexer nesta campanha, dono ou admin agindo por ele.
 */
async function tenantDaCampanha(campaignId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("mtproto_scheduled_campaigns")
    .select("tenant_id")
    .eq("id", campaignId)
    .maybeSingle();
  return (campaign?.tenant_id as string | undefined) ?? null;
}

/**
 * Próxima `position` livre de uma campanha: mesma regra de
 * lib/social-proof/position.ts (max+1, nunca length+1 — que colide depois de
 * apagar uma mensagem do meio e recarregar), só que escopada por
 * campaign_id em vez de channel_id.
 */
async function proximaPosicaoCampanha(campaignId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mtproto_scheduled_messages")
    .select("position")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  return nextPosition((data as { position: number } | null)?.position ?? null);
}

/**
 * Só canal e supergrupo entram: promoteBotToAdmin monta Api.InputChannel, e
 * grupo legacy (peer_type 'chat') não tem InputChannel. Oferecer um destino
 * que o bot nunca conseguiria administrar seria prometer o que não se cumpre.
 *
 * Já degrada pro vazio em qualquer recusa (sem assinatura incluso) — nada
 * novo a fazer aqui pra ficar consistente com comGuarda.
 */
export async function listDestinationDialogs(
  actingTenantId?: string,
): Promise<Array<{ id: string; label: string; accountId: string }>> {
  try {
    await requireAutomationsAccess();
    const tenantId = await resolveActingTenantId(actingTenantId);
    const supabase = await createClient();
    const { data } = await supabase
      .from("mtproto_dialogs")
      .select("id, title, username, kind, account_id, mtproto_accounts!inner(tenant_id)")
      .eq("mtproto_accounts.tenant_id", tenantId)
      .eq("peer_type", "channel")
      .in("kind", ["channel_owner", "group_admin"])
      .order("title", { ascending: true });
    return (data ?? []).map((d) => ({
      id: d.id as string,
      label: (d.title as string | null) ?? (d.username as string | null) ?? "(sem nome)",
      accountId: d.account_id as string,
    }));
  } catch {
    return [];
  }
}

export async function setCampaignDestination(
  campaignId: string,
  dialogId: string,
): Promise<ActionResult> {
  return comGuarda("setCampaignDestination", async () => {
    const supabase = await createClient();

    const { data: dialog } = await supabase
      .from("mtproto_dialogs")
      .select("id, peer_id, peer_access_hash, peer_type, title")
      .eq("id", dialogId)
      .maybeSingle();
    if (!dialog) return { ok: false, error: "Destino não encontrado." };
    if (dialog.peer_type !== "channel") {
      return {
        ok: false,
        error: "Só canal ou supergrupo pode ser destino — grupo comum não aceita bot como admin.",
      };
    }

    // Snapshot: o dialog pode sumir num sync futuro e o envio precisa do peer.
    const { data, error } = await supabase
      .from("mtproto_scheduled_campaigns")
      .update({
        dest_dialog_id: dialog.id,
        dest_channel_id: dialog.peer_id,
        dest_access_hash: dialog.peer_access_hash,
        dest_title: dialog.title,
      })
      .eq("id", campaignId)
      .select("id");
    if (error) return { ok: false, error: `Não deu pra salvar o destino: ${error.message}` };
    // Sem linha afetada o supabase-js NÃO devolve error: a RLS pode ter barrado
    // tudo e a action responderia { ok: true }, sucesso silencioso.
    if (!data || data.length === 0) {
      return { ok: false, error: "Campanha não encontrada (ou sem permissão)." };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

export async function saveScheduledMessage(
  campaignId: string,
  input: MessageInput,
): Promise<ActionResult> {
  return comGuarda("saveScheduledMessage", async () => {
    const valido = validateMessage(input);
    if (!valido.ok) return valido;

    const tenantId = await tenantDaCampanha(campaignId);
    if (!tenantId) return { ok: false, error: "Campanha não encontrada." };

    const supabase = await createClient();

    // Só os campos que mtproto_scheduled_messages realmente tem: o restante do
    // MessageInput (sender_kind, reações, views…) é exclusivo da Prova Social —
    // ver o comentário em lib/composer/types.ts.
    const row = {
      tenant_id: tenantId,
      campaign_id: campaignId,
      kind: input.kind,
      content_text: (input.content_text ?? "").trim() === "" ? null : input.content_text,
      media: input.media,
      reply_to_id: input.reply_to_id,
      delay_seconds: Math.max(0, input.delay_seconds ?? 0),
      silent: input.silent ?? true,
    };

    if (input.id) {
      // `.eq("campaign_id", campaignId)` além do id: esta é uma Server Action,
      // invocável direto por qualquer sessão autenticada, e sem o escopo por
      // campanha a única barreira contra editar a mensagem de outra campanha
      // seria a RLS. `position` fica de fora do update de propósito: quem
      // define a ordem é o insert (max+1) ou o reorder, nunca um update de
      // conteúdo.
      const { data, error } = await supabase
        .from("mtproto_scheduled_messages")
        .update(row)
        .eq("id", input.id)
        .eq("campaign_id", campaignId)
        .select("id");

      if (error) return { ok: false, error: `Não deu pra salvar a mensagem: ${error.message}` };
      // Sem linha afetada o supabase-js NÃO devolve error — a RLS pode ter
      // barrado 100% das linhas e a action responderia { ok: true }, sucesso
      // silencioso. A contagem é a única prova de que algo mudou de verdade.
      if (!data || data.length === 0) {
        return {
          ok: false,
          error: "Mensagem não encontrada nesta campanha (ou sem permissão pra editar).",
        };
      }
    } else {
      // Posição calculada AQUI, nunca no cliente — mesmo raciocínio de
      // lib/social-proof/position.ts.
      const { error } = await supabase.from("mtproto_scheduled_messages").insert({
        ...row,
        position: await proximaPosicaoCampanha(campaignId),
      });

      if (error) return { ok: false, error: `Não deu pra salvar a mensagem: ${error.message}` };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

export async function deleteScheduledMessage(
  id: string,
  campaignId: string,
): Promise<ActionResult> {
  return comGuarda("deleteScheduledMessage", async () => {
    const supabase = await createClient();

    // Mesmo raciocínio do update: escopo por campanha além do id (Server
    // Action é invocável direto), e contagem de linhas afetadas porque delete
    // que não pegou nada não vira `error` no supabase-js — viraria
    // { ok: true } falso.
    const { data, error } = await supabase
      .from("mtproto_scheduled_messages")
      .delete()
      .eq("id", id)
      .eq("campaign_id", campaignId)
      .select("id");

    if (error) return { ok: false, error: `Não deu pra apagar: ${error.message}` };
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: "Mensagem não encontrada nesta campanha (ou sem permissão pra apagar).",
      };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

/**
 * Copia uma mensagem para o fim da fila.
 *
 * Lê a linha com o client sob RLS — se o tenant não puder ver, não pode
 * duplicar, e a checagem sai de graça. A cópia nasce com position nova, SEM
 * herdar reply_to_id (uma resposta duplicada apontaria pra mesma citação em
 * dois pontos da fila) e sem herdar status/campos de envio ou de IA: é uma
 * mensagem nova, ainda não processada.
 */
export async function duplicateScheduledMessage(
  id: string,
  campaignId: string,
): Promise<ActionResult> {
  return comGuarda("duplicateScheduledMessage", async () => {
    const supabase = await createClient();

    const { data: origem } = await supabase
      .from("mtproto_scheduled_messages")
      .select("tenant_id,campaign_id,kind,content_text,media,reply_to_id,delay_seconds,silent")
      .eq("id", id)
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (!origem) {
      return { ok: false, error: "Mensagem não encontrada nesta campanha (ou sem permissão)." };
    }

    const { error } = await supabase.from("mtproto_scheduled_messages").insert({
      ...origem,
      reply_to_id: null,
      position: await proximaPosicaoCampanha(campaignId),
    });

    if (error) return { ok: false, error: `Não deu pra duplicar: ${error.message}` };

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

/**
 * Grava a ordem nova depois de arrastar-e-soltar.
 *
 * As posições são reescritas como 1..N em vez de trocar duas: depois de
 * vários arrastes as posições ficam com buracos, e renumerar mantém a fila
 * estável e previsível. Cada update leva `.eq("campaign_id", campaignId)` —
 * a lista de ids vem do cliente e não pode ser confiada sozinha.
 */
export async function reorderScheduledMessages(
  campaignId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  return comGuarda("reorderScheduledMessages", async () => {
    if (orderedIds.length === 0) return { ok: true };

    const supabase = await createClient();

    // Confere a lista ANTES de escrever qualquer coisa. Uma lista parcial, ou
    // com id que não é desta campanha, faria as posições 1..N colidirem com as
    // posições antigas das mensagens deixadas de fora — e o loop abaixo não é
    // transacional, então metade já estaria gravada quando o problema
    // aparecesse.
    //
    // A leitura passa pela RLS, então `existentes` já é só o que o tenant
    // enxerga.
    const { data: existentes, error: erroLeitura } = await supabase
      .from("mtproto_scheduled_messages")
      .select("id")
      .eq("campaign_id", campaignId);

    if (erroLeitura) {
      return { ok: false, error: `Não deu pra ler as mensagens: ${erroLeitura.message}` };
    }

    const daCampanha = new Set((existentes ?? []).map((m) => m.id as string));

    // Três condições, e a de unicidade não é redundante: ["a","a"] contra uma
    // campanha com {a,b} tem o tamanho certo E todos os ids pertencem à
    // campanha, mas omite "b" — o laço gravaria "a" duas vezes e deixaria "b"
    // colidindo na posição antiga. Sem esta linha, a colisão silenciosa volta
    // por outra porta.
    const semRepeticao = new Set(orderedIds).size === orderedIds.length;
    const permutacaoCompleta =
      semRepeticao &&
      orderedIds.length === daCampanha.size &&
      orderedIds.every((id) => daCampanha.has(id));

    if (!permutacaoCompleta) {
      return {
        ok: false,
        error: "A lista de mensagens mudou. Recarregue a página e tente de novo.",
      };
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase
        .from("mtproto_scheduled_messages")
        .update({ position: i + 1 })
        .eq("id", orderedIds[i])
        .eq("campaign_id", campaignId);

      if (error) return { ok: false, error: `Não deu pra reordenar: ${error.message}` };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

export async function setCampaignSchedule(
  campaignId: string,
  input: { startAt: string; defaultDelaySeconds: number },
): Promise<ActionResult> {
  return comGuarda("setCampaignSchedule", async () => {
    const startAt = new Date(input.startAt);
    if (Number.isNaN(startAt.getTime())) {
      return { ok: false, error: "Horário de início inválido." };
    }
    if (input.defaultDelaySeconds < 0) {
      return { ok: false, error: "O intervalo padrão não pode ser negativo." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("mtproto_scheduled_campaigns")
      .update({
        start_at: startAt.toISOString(),
        default_delay_seconds: input.defaultDelaySeconds,
      })
      .eq("id", campaignId)
      .select("id");

    if (error) return { ok: false, error: `Não deu pra salvar o agendamento: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, error: "Campanha não encontrada (ou sem permissão)." };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

/** Inverte `ai_discarded` — usado tanto pra descartar manualmente quanto,
 *  com `discarded=false`, pra restaurar uma mensagem que a IA descartou. */
export async function toggleDiscarded(
  id: string,
  campaignId: string,
  discarded: boolean,
): Promise<ActionResult> {
  return comGuarda("toggleDiscarded", async () => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("mtproto_scheduled_messages")
      .update({ ai_discarded: discarded })
      .eq("id", id)
      .eq("campaign_id", campaignId)
      .select("id");

    if (error) return { ok: false, error: `Não deu pra atualizar: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, error: "Mensagem não encontrada nesta campanha (ou sem permissão)." };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

export async function revertAiText(id: string, campaignId: string): Promise<ActionResult> {
  return comGuarda("revertAiText", async () => {
    const supabase = await createClient();

    const { data: msg } = await supabase
      .from("mtproto_scheduled_messages")
      .select("content_text_original")
      .eq("id", id)
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (!msg) {
      return { ok: false, error: "Mensagem não encontrada nesta campanha (ou sem permissão)." };
    }
    if (msg.content_text_original === null) {
      return { ok: false, error: "Esta mensagem não foi alterada pela IA." };
    }

    const { data, error } = await supabase
      .from("mtproto_scheduled_messages")
      .update({
        content_text: msg.content_text_original,
        content_text_original: null,
        ai_action: "none",
      })
      .eq("id", id)
      .eq("campaign_id", campaignId)
      .select("id");

    if (error) return { ok: false, error: `Não deu pra reverter: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, error: "Mensagem não encontrada nesta campanha (ou sem permissão)." };
    }

    revalidatePath(rota(campaignId));
    return { ok: true };
  });
}

/**
 * Publica: calcula os horários absolutos e liga a campanha.
 *
 * A validação do bot como admin do destino NÃO acontece aqui — ela exige o
 * worker (o Next não fala MTProto). Quem confere e promove é
 * ensureBotAccess (Task 10), chamado pela tela antes do usuário publicar. Se
 * ele for pulado, o worker ainda recusa a primeira mensagem com erro legível
 * em vez de publicar em lugar nenhum.
 */
export async function launchScheduledCampaign(
  campaignId: string,
  startAtIso: string,
): Promise<ActionResult> {
  return comGuarda("launchScheduledCampaign", async () => {
    const supabase = await createClient();

    const { data: campaign } = await supabase
      .from("mtproto_scheduled_campaigns")
      .select("id, dest_channel_id, dest_access_hash, status")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign) return { ok: false, error: "Campanha não encontrada (ou sem permissão)." };
    if (!campaign.dest_channel_id) {
      return { ok: false, error: "Escolha o canal de destino antes de publicar." };
    }
    if (campaign.status === "running") {
      return { ok: false, error: "Esta campanha já está publicando." };
    }

    const startAt = new Date(startAtIso);
    if (Number.isNaN(startAt.getTime())) {
      return { ok: false, error: "Horário de início inválido." };
    }

    const { data: rows } = await supabase
      .from("mtproto_scheduled_messages")
      .select("id, delay_seconds, ai_discarded")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    const agenda = accumulateSchedule(
      (rows ?? []).map((r) => ({
        id: r.id as string,
        delay_seconds: r.delay_seconds as number,
        ai_discarded: r.ai_discarded as boolean,
      })),
      startAt,
    );
    if (agenda.length === 0) {
      return { ok: false, error: "Não há nenhuma mensagem pendente pra publicar." };
    }

    for (const item of agenda) {
      const { error } = await supabase
        .from("mtproto_scheduled_messages")
        .update({ scheduled_at: item.scheduledAt.toISOString() })
        .eq("id", item.id)
        .eq("campaign_id", campaignId);
      if (error) return { ok: false, error: `Não deu pra agendar: ${error.message}` };
    }

    // Descartadas viram 'skipped' AGORA: deixá-las 'pending' faria o poller
    // enfileirá-las (elas não têm scheduled_at, mas um reprocessamento futuro
    // poderia dar), e o contador de progresso mentiria.
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ status: "skipped" })
      .eq("campaign_id", campaignId)
      .eq("ai_discarded", true)
      .eq("status", "pending");

    const { error } = await supabase
      .from("mtproto_scheduled_campaigns")
      .update({
        status: "running",
        start_at: startAt.toISOString(),
        started_at: new Date().toISOString(),
        total_messages: agenda.length,
        last_error: null,
      })
      .eq("id", campaignId);
    if (error) return { ok: false, error: `Não deu pra publicar: ${error.message}` };

    revalidatePath(rota(campaignId));
    revalidatePath("/dashboard/automations");
    return { ok: true };
  });
}

/** `status = 'paused'`. O poller para de enfileirar; o que já está na fila
 *  termina normalmente — pausar não cancela envios em voo. */
export async function pauseScheduledCampaign(campaignId: string): Promise<ActionResult> {
  return comGuarda("pauseScheduledCampaign", async () => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("mtproto_scheduled_campaigns")
      .update({ status: "paused" })
      .eq("id", campaignId)
      .select("id");

    if (error) return { ok: false, error: `Não deu pra pausar: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, error: "Campanha não encontrada (ou sem permissão)." };
    }

    revalidatePath(rota(campaignId));
    revalidatePath("/dashboard/automations");
    return { ok: true };
  });
}
