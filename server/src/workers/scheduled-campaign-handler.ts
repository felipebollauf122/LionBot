import path from "node:path";
import os from "node:os";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { CompanionBot } from "../services/mtproto/clone/bot-client.js";
import { extractWaitSeconds } from "../services/mtproto/flood.js";
import type { CloneMediaKind } from "../services/mtproto/clone/media-plan.js";
import type { Api } from "telegram";

/** Tentativas antes de desistir de uma mensagem. */
const MAX_ATTEMPTS = 3;

/** Janela de obsolescência do claim, mesmo padrão de clone-handler. */
export const SEND_CLAIM_STALE_MS = 10 * 60 * 1000;

export interface FloodInput {
  now: Date;
  waitSeconds: number;
  /** Pendentes da MESMA campanha, com scheduled_at futuro ou passado. */
  pendentes: Array<{ id: string; scheduledAt: Date }>;
}

/**
 * Reagendamento após FLOOD_WAIT.
 *
 * O ponto não óbvio: empurrar SÓ a mensagem que bateu no flood faz a fila
 * inteira vencer durante a espera, e quando ela passa o bot publica tudo de
 * uma vez — exatamente o comportamento que queima a conta. O delta é aplicado
 * a todas as pendentes, com piso em `retryAt` pra que uma já atrasada não saia
 * junto da reagendada.
 */
export function nextFloodSchedule(input: FloodInput): {
  retryAt: Date;
  empurradas: Array<{ id: string; scheduledAt: Date }>;
} {
  const deltaMs = (input.waitSeconds + 5) * 1000;
  const retryAt = new Date(input.now.getTime() + deltaMs);
  const empurradas = input.pendentes.map((p) => ({
    id: p.id,
    scheduledAt: new Date(Math.max(p.scheduledAt.getTime() + deltaMs, retryAt.getTime())),
  }));
  return { retryAt, empurradas };
}

/** Teto de campanhas olhadas por tick do poller. */
export const POLLER_LIMITE_CAMPANHAS = 50;

/**
 * Desfecho de uma campanha cuja fila esvaziou.
 *
 * O que este branch não tinha: NADA jamais escrevia status='failed' nem
 * `last_error`. `concluirSeUltima` só olhava se ainda havia pendente, então
 * uma campanha em que TODAS as mensagens falharam terminava 'completed' e o
 * cabeçalho anunciava "concluída · 0/12 enviadas" — e a faixa vermelha de
 * `last_error` (campaign-composer.tsx) era código inalcançável.
 *
 * A regra é a mais simples que não mente: campanha que não publicou NADA não
 * foi concluída. O texto vai em português porque é ele que o dono lê na
 * faixa vermelha da tela — não é log.
 */
export function decidirDesfecho(contagem: { enviadas: number; falhadas: number }): {
  status: "completed" | "failed";
  lastError: string | null;
} {
  if (contagem.enviadas > 0) return { status: "completed", lastError: null };

  if (contagem.falhadas > 0) {
    const detalhe =
      contagem.falhadas === 1
        ? "a única mensagem falhou"
        : `todas as ${contagem.falhadas} mensagens falharam`;
    return {
      status: "failed",
      lastError: `Nenhuma mensagem foi publicada: ${detalhe}. Abra a fila e veja o erro de cada uma.`,
    };
  }

  // Nem enviada, nem falha: a fila esvaziou por outro caminho (o dono apagou
  // ou descartou tudo). Também não é conclusão.
  return {
    status: "failed",
    lastError: "A campanha terminou sem publicar nenhuma mensagem: a fila ficou vazia.",
  };
}

/**
 * Leituras que o tick do poller precisa. Injetadas em vez de chamadas direto,
 * mesmo padrão de CloneRunnerDeps/RunnerDeps, pra a decisão do poller —
 * "quem é pulado e quem é enfileirado" — ser testável sem banco nem fila.
 */
export interface PollerDeps {
  /**
   * Campanhas em 'running', DA MAIS ANTIGA PRA MAIS NOVA e no máximo
   * `limite`. A ordem é contrato: como a consulta é limitada, sem ela as
   * campanhas além do teto poderiam nunca ser alcançadas.
   */
  campanhasRodando(limite: number): Promise<string[]>;
  /** Dentre as candidatas, as que já têm mensagem em 'sending'. */
  comEnvioEmVoo(campaignIds: string[]): Promise<string[]>;
  /**
   * Dentre as candidatas, as que ainda têm mensagem AGENDADA por publicar
   * (`status='pending'` COM `scheduled_at`). Sem o `scheduled_at` a mensagem
   * não pertence a esta rodada — é o caso de uma criada no composer depois do
   * disparo, ou restaurada de um descarte — e o poller nunca conseguiria
   * publicá-la: contá-la aqui prenderia a campanha em 'running' pra sempre.
   */
  comFilaPendente(campaignIds: string[]): Promise<string[]>;
  /** Id da mensagem vencida mais antiga da campanha, ou null se não há. */
  proximaVencida(campaignId: string, agoraIso: string): Promise<string | null>;
  enfileirar(messageId: string): Promise<void>;
  /** Fecha a campanha (completed/failed) por `decidirDesfecho`. */
  assentar(campaignId: string): Promise<void>;
}

/**
 * Um tick do poller de disparo.
 *
 * A regra que este código existe pra manter é UMA MENSAGEM EM VOO POR
 * CAMPANHA. "Uma por tick" não basta: uma publicação de 50MB dura mais que os
 * 30s do intervalo e, no tick seguinte, ela já não está 'pending' (está
 * 'sending'), então a próxima entraria por cima — e com concurrency 4 a
 * segunda publicaria antes da primeira, fora da ordem que o dono montou.
 */
export async function tickCampanhasAgendadas(
  deps: PollerDeps,
  agora: Date,
  limite: number = POLLER_LIMITE_CAMPANHAS,
): Promise<{ enfileiradas: string[]; puladas: string[]; assentadas: string[] }> {
  const campanhas = await deps.campanhasRodando(limite);
  if (campanhas.length === 0) return { enfileiradas: [], puladas: [], assentadas: [] };

  // Duas consultas respondem por todas as candidatas, não duas por campanha.
  const ocupadas = new Set(await deps.comEnvioEmVoo(campanhas));
  const comFila = new Set(await deps.comFilaPendente(campanhas));
  const agoraIso = agora.toISOString();
  const enfileiradas: string[] = [];
  const puladas: string[] = [];
  const assentadas: string[] = [];

  for (const campaignId of campanhas) {
    if (ocupadas.has(campaignId)) {
      puladas.push(campaignId);
      continue;
    }
    // Nada em voo E nada agendado por publicar: a campanha acabou, seja lá
    // por que caminho a fila esvaziou.
    //
    // Antes, só um envio ou uma falha chamavam `concluirSeUltima` — então
    // apagar a última pendente de uma campanha em curso a deixava 'running'
    // PRA SEMPRE, e como o poller ordena por started_at crescente ela ficava
    // ocupando o topo de uma janela de 50 vagas, matando de fome as
    // campanhas dos outros tenants.
    if (!comFila.has(campaignId)) {
      await deps.assentar(campaignId);
      assentadas.push(campaignId);
      continue;
    }
    const messageId = await deps.proximaVencida(campaignId, agoraIso);
    if (!messageId) continue;
    await deps.enfileirar(messageId);
    enfileiradas.push(messageId);
  }
  return { enfileiradas, puladas, assentadas };
}

export async function handleScheduledSend(messageId: string): Promise<void> {
  // 1) Claim CAS. Sem linha de volta, outro worker pegou (ou já não é pending).
  const agora = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("mtproto_scheduled_messages")
    .update({ status: "sending", claimed_at: agora })
    .eq("id", messageId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (!claimed) {
    console.log(`[postcampaign] mensagem ${messageId} não reivindicada, ignorando`);
    return;
  }
  // A assinatura DESTE claim. `status = 'sending'` sozinho prova que ALGUÉM
  // detém a trava, não que somos nós: numa publicação mais lenta que
  // SEND_CLAIM_STALE_MS o sweep devolve a linha pra 'pending', um segundo
  // worker reivindica (status volta a 'sending', com claimed_at NOVO) e a
  // nossa conclusão atrasada ainda casaria com o status — ABA clássico, com
  // post duplicado no canal e nenhum rastro na linha. Preferimos o claimed_at
  // que o banco devolveu ao que mandamos: é literalmente o valor gravado.
  const nossoClaim = (claimed.claimed_at as string | null) ?? agora;

  const { data: campaign } = await supabase
    .from("mtproto_scheduled_campaigns")
    .select("*")
    .eq("id", claimed.campaign_id)
    .single();
  if (!campaign || campaign.status !== "running") {
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ status: "pending", claimed_at: null })
      .eq("id", messageId)
      .eq("status", "sending")
      .eq("claimed_at", nossoClaim);
    return;
  }

  // Sem destino não existe chat_id: `-100null` viraria três tentativas de
  // Bot API com erro obscuro antes de falhar. Falha logo, com o motivo.
  if (!campaign.dest_channel_id) {
    await falhar(messageId, campaign.id, "campanha sem canal de destino", nossoClaim);
    return;
  }

  const { data: botRow } = await supabase
    .from("automation_bots")
    .select("token, username, status")
    .eq("tenant_id", campaign.tenant_id)
    .single();
  if (!botRow || botRow.status !== "active") {
    await falhar(messageId, campaign.id, "bot companheiro não cadastrado ou inválido", nossoClaim);
    return;
  }

  const bot = new CompanionBot(
    botRow.token,
    CompanionBot.destChatIdFromChannelId(campaign.dest_channel_id as string),
    null,
    { apiId: config.telegramApiId, apiHash: config.telegramApiHash },
  );
  const tmpDir = path.join(os.tmpdir(), "eaglebot-postcampaign", messageId);

  try {
    const destMsgId = await publicar(bot, claimed, tmpDir);
    // A gravação do resultado é CAS presa ao NOSSO claim (status + claimed_at,
    // ver `nossoClaim` lá em cima). Sem ela, o worker que perdeu a trava
    // sobrescreveria o dest_msg_id do vencedor e a duplicata não deixaria
    // rastro nenhum na linha.
    const { data: gravado } = await supabase
      .from("mtproto_scheduled_messages")
      .update({
        status: "sent",
        dest_msg_id: destMsgId,
        sent_at: new Date().toISOString(),
        claimed_at: null,
        error_message: null,
      })
      .eq("id", messageId)
      .eq("status", "sending")
      .eq("claimed_at", nossoClaim)
      .select("id")
      .maybeSingle();
    if (!gravado) {
      console.warn(
        `[postcampaign] mensagem ${messageId} publicada como ${destMsgId} mas perdemos a corrida do claim — resultado descartado (o vencedor mantém o dele; possível duplicata no destino)`,
      );
      return;
    }
    await recontar(campaign.id, "sent");
    if (claimed.is_pinned) {
      await bot.pin(destMsgId).catch((e) => console.warn("[postcampaign] pin falhou:", e));
    }
    await assentarCampanhaSeVazia(campaign.id);
  } catch (err) {
    const wait = extractWaitSeconds(err);
    if (wait !== null) {
      await reagendarPorFlood(messageId, campaign.id, wait, nossoClaim);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const tentativas = (claimed.attempts as number) + 1;
    if (tentativas >= MAX_ATTEMPTS) {
      await falhar(messageId, campaign.id, msg, nossoClaim);
    } else {
      // Volta pra pending com uma tentativa a mais contabilizada; o poller
      // reenfileira no próximo tick porque scheduled_at já venceu.
      await supabase
        .from("mtproto_scheduled_messages")
        .update({ status: "pending", claimed_at: null, attempts: tentativas, error_message: msg })
        .eq("id", messageId)
        .eq("status", "sending")
        .eq("claimed_at", nossoClaim);
    }
  } finally {
    await bot.disconnect().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Baixa uma URL pública do Storage pro disco, pro InputFile do grammy. */
async function baixar(url: string, dir: string, nome: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download da mídia falhou (${res.status}): ${url}`);
  const destino = path.join(dir, nome);
  await writeFile(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
}

async function publicar(
  bot: CompanionBot,
  row: Record<string, unknown>,
  tmpDir: string,
): Promise<number> {
  const texto = (row.content_text as string | null) ?? "";
  const entities = (row.entities as Api.TypeMessageEntity[] | null) ?? undefined;
  const inlineLinks =
    (row.inline_links as Array<{ label: string; url: string }> | null) ?? undefined;
  const silent = row.silent !== false;
  const opts = { entities, inlineLinks, silent };
  const media = (row.media as Array<{ url: string; type: string }> | null) ?? [];

  switch (row.kind as string) {
    case "text":
      return bot.publishText(texto, opts);

    case "poll": {
      const poll = row.poll as {
        question: string;
        options: string[];
        isAnonymous: boolean;
        allowsMultipleAnswers: boolean;
      };
      return bot.publishPoll(poll, { silent });
    }

    case "album": {
      const itens: Array<{
        filePath: string;
        kind: "photo" | "video";
        caption: string;
        entities?: Api.TypeMessageEntity[];
      }> = [];
      for (let i = 0; i < media.length; i++) {
        itens.push({
          filePath: await baixar(media[i].url, tmpDir, `item_${i}`),
          kind: media[i].type === "video" ? ("video" as const) : ("photo" as const),
          caption: i === 0 ? texto : "",
          entities: i === 0 ? entities : undefined,
        });
      }
      const ids = await bot.publishAlbum(itens, { silent });
      if (ids.length === 0) throw new Error("álbum publicado sem devolver id");
      return ids[0];
    }

    default: {
      // photo | video | audio | document
      const item = media[0];
      if (!item) throw new Error(`mensagem ${String(row.kind)} sem mídia gravada`);
      const nome = (row.file_name as string | null) ?? `arquivo_${String(row.id)}`;
      const filePath = await baixar(item.url, tmpDir, nome);
      const kind: CloneMediaKind =
        row.kind === "video"
          ? "video"
          : row.kind === "audio"
            ? "audio"
            : row.kind === "document"
              ? "document"
              : "photo";
      return bot.publishMedia(filePath, kind, texto, { ...opts, fileName: nome });
    }
  }
}

async function reagendarPorFlood(
  messageId: string,
  campaignId: string,
  waitSeconds: number,
  nossoClaim: string,
): Promise<void> {
  // Paginado e ordenado de propósito. Sem `range` explícito o PostgREST corta
  // a resposta em `db-max-rows` sem avisar, e sem ordem o corte é um
  // subconjunto arbitrário: parte da campanha ficaria SEM o empurrão e
  // venceria durante a espera — exatamente o despejo que esta função existe
  // pra impedir. A ordem é a mesma do poller (scheduled_at, position,
  // created_at), então as páginas não se sobrepõem nem pulam linhas.
  const PAGINA = 500;
  const pendentes: Array<{ id: string; scheduledAt: Date }> = [];
  for (let pagina = 0; pagina < 200; pagina++) {
    const de = pagina * PAGINA;
    const { data } = await supabase
      .from("mtproto_scheduled_messages")
      .select("id, scheduled_at")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (!data || data.length === 0) break;
    for (const p of data) {
      pendentes.push({ id: p.id as string, scheduledAt: new Date(p.scheduled_at as string) });
    }
    if (data.length < PAGINA) break;
  }

  const { retryAt, empurradas } = nextFloodSchedule({
    now: new Date(),
    waitSeconds,
    pendentes,
  });

  await supabase
    .from("mtproto_scheduled_messages")
    .update({
      status: "pending",
      claimed_at: null,
      scheduled_at: retryAt.toISOString(),
      error_message: `flood_wait_${waitSeconds}s`,
    })
    .eq("id", messageId)
    .eq("status", "sending")
    .eq("claimed_at", nossoClaim);

  // Um UPDATE por mensagem: o PostgREST não escreve valor diferente por linha
  // numa chamada só, e cada empurrada tem o seu próprio scheduled_at. Numa
  // campanha de 500 são 500 idas ao banco — custo aceitável porque só
  // acontece em flood, quando a campanha já está parada esperando. Se
  // incomodar, o caminho é um rpc() que aplique o delta no servidor.
  for (const e of empurradas) {
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ scheduled_at: e.scheduledAt.toISOString() })
      .eq("id", e.id);
  }
  console.warn(
    `[postcampaign] flood de ${waitSeconds}s na campanha ${campaignId}: ${empurradas.length} mensagens empurradas`,
  );
}

async function falhar(
  messageId: string,
  campaignId: string,
  erro: string,
  nossoClaim: string,
): Promise<void> {
  // CAS pelo mesmo motivo do caminho de sucesso: quem perdeu o claim não
  // marca a linha do vencedor como falha nem soma no contador da campanha.
  const { data: gravado } = await supabase
    .from("mtproto_scheduled_messages")
    .update({ status: "failed", error_message: erro, claimed_at: null })
    .eq("id", messageId)
    .eq("status", "sending")
    .eq("claimed_at", nossoClaim)
    .select("id")
    .maybeSingle();
  if (!gravado) {
    console.warn(`[postcampaign] falha da mensagem ${messageId} ignorada: claim já não era nosso`);
    return;
  }
  await recontar(campaignId, "failed");
  await assentarCampanhaSeVazia(campaignId);
}

/**
 * Recalcula o contador a partir da FONTE (as linhas de mensagem), em vez de
 * ler o valor atual e somar 1.
 *
 * Read-modify-write perde atualização sob concorrência: dois desfechos quase
 * simultâneos leem 4, os dois gravam 5, e uma publicação some do contador. O
 * poller garante uma mensagem em voo por campanha — mas essa garantia é do
 * POLLER, e o job também chega por retry do BullMQ e pelo sweep de claim
 * órfão. Um contador não pode depender de invariante de outro módulo.
 *
 * Contar converge: as duas escritas concorrentes leem a mesma tabela de
 * mensagens, e o status da linha é gravado ANTES desta chamada — então todo
 * valor escrito é uma contagem que existiu de verdade, e a última é a certa.
 * Custa as mesmas duas idas ao banco que o read-modify-write custava.
 */
async function recontar(campaignId: string, kind: "sent" | "failed"): Promise<void> {
  const coluna = kind === "sent" ? "sent_count" : "failed_count";
  await supabase
    .from("mtproto_scheduled_campaigns")
    .update({ [coluna]: await contar(campaignId, kind) })
    .eq("id", campaignId);
}

/** Quantas linhas da campanha estão neste status. */
async function contar(campaignId: string, status: string): Promise<number> {
  const { count } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", status);
  return count ?? 0;
}

/**
 * Fecha a campanha se não sobrou nada por publicar — com o desfecho REAL
 * (completed ou failed), não só 'completed'.
 *
 * Chamada dos dois lados: por cada envio/falha aqui no worker, e pelo tick do
 * poller (a campanha cuja fila esvaziou por qualquer outro caminho — o dono
 * apagou a última pendente, por exemplo).
 */
export async function assentarCampanhaSeVazia(campaignId: string): Promise<void> {
  const { count: emVoo } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sending");
  if ((emVoo ?? 0) > 0) return;

  // Pendente SEM scheduled_at não pertence a esta rodada (criada no composer
  // depois do disparo, ou restaurada de um descarte) e o poller nunca a
  // publicaria — contá-la aqui prenderia a campanha em 'running' pra sempre.
  // Ela volta a valer no próximo "Publicar campanha".
  const { count: agendadas } = await supabase
    .from("mtproto_scheduled_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .not("scheduled_at", "is", null);
  if ((agendadas ?? 0) > 0) return;

  const desfecho = decidirDesfecho({
    enviadas: await contar(campaignId, "sent"),
    falhadas: await contar(campaignId, "failed"),
  });

  await supabase
    .from("mtproto_scheduled_campaigns")
    .update({
      status: desfecho.status,
      last_error: desfecho.lastError,
      completed_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    // Só quem estava de fato em curso. Sem o CAS, uma campanha reaberta como
    // rascunho (ou já republicada) entre a contagem e a escrita seria
    // carimbada como encerrada por cima.
    .in("status", ["running", "paused"]);
}
