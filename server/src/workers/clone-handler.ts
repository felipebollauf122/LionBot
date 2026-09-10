// Fio de integração da clonagem (Task 11): carrega o job, a conta MTProto e o
// bot companheiro do Supabase, monta o destino, escolhe a estratégia e injeta
// implementações reais em cada dependência do CloneRunner (Tasks 4-10).
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { MtprotoClient } from "../services/mtproto/client.js";
import type { PeerKind } from "../services/mtproto/client.js";
import { parseLinkIdentifier } from "../services/mtproto/link-parse.js";
import { CompanionBot } from "../services/mtproto/clone/bot-client.js";
import {
  SourceReader,
  READ_THROTTLE_MS,
} from "../services/mtproto/clone/source-reader.js";
import { ensureDestination } from "../services/mtproto/clone/dest-builder.js";
import {
  chooseStrategy,
  createPublisher,
  MAX_FILE_BYTES,
} from "../services/mtproto/clone/publish-router.js";
import { createDraftPublisher } from "../services/mtproto/clone/draft-publisher.js";
import { finalizarCampanhaDoRascunho } from "../services/mtproto/clone/draft-finalize.js";
import type { StagedRow } from "../services/mtproto/clone/draft-publisher.js";
import { downloadAndRehostMedia } from "../services/mtproto/bot-clone/media-rehost.js";
import { rewriteMessageLinks } from "../services/mtproto/clone/link-replace.js";
import { iterHistoryAscending } from "../services/mtproto/clone/history-iterator.js";
import { CloneRunner } from "../services/mtproto/clone/clone-runner.js";
import { syncTopics, finalizeTopics } from "../services/mtproto/clone/topic-sync.js";
import { enqueueMtproto } from "../queue-mtproto.js";
import { extractWaitSeconds } from "../services/mtproto/flood.js";
import { isUserRestricted } from "../services/mtproto/clone/user-restricted.js";
import type {
  CloneMapRow,
  CloneOutcome,
  CloneStatus,
  ClonePeer,
  CloneTopicMapRow,
  SourceMessage,
} from "../services/mtproto/clone/types.js";

/**
 * Defeito I4: erros do Telegram que significam "isso já estava feito". A
 * promoção do bot agora roda em toda retomada (ver ensureDestination), não
 * só na criação do canal — então um job cujo run anterior JÁ tinha promovido
 * o bot com sucesso (ex.: retomada por FLOOD_WAIT durante a *publicação*,
 * muito depois da promoção) vai chamar promoteBotToAdmin de novo, e o
 * Telegram recusa reconvidar/repromover quem já está lá. Tratar essas
 * respostas como sucesso evita falhar um resume que, antes desse fix, nem
 * revisitava a promoção. Qualquer outro erro (BOT_GROUPS_BLOCKED por Group
 * Privacy do bot, RIGHT_FORBIDDEN, flood) é genuíno e sobe pra falhar o job
 * — o contrato "promoção é fatal" continua valendo.
 */
const PROMOTE_ALREADY_DONE = /USER_ALREADY_PARTICIPANT|USER_ALREADY_INVITED|NOT_MODIFIED/i;

async function promoteBotTolerant(
  client: MtprotoClient,
  channelId: string,
  accessHash: string,
  botUsername: string,
): Promise<void> {
  try {
    await client.promoteBotToAdmin(channelId, accessHash, botUsername);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (PROMOTE_ALREADY_DONE.test(msg)) {
      console.warn(`[clone.dest] promoteBot já satisfeito (${msg}), tratando como sucesso`);
      return;
    }
    throw err;
  }
}

/** Janela de obsolescência da trava de processamento (defeito I6b). */
const PROCESSING_CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Agenda a retomada de um FLOOD_WAIT/SLOWMODE_WAIT: escreve `resume_after` e
 * reenfileira `clone.run` com o mesmo delay (+5s de folga sobre o que o
 * Telegram pediu — reenfileirar na hora giraria em loop no mesmo flood).
 * Compartilhado entre o loop de publicação (CloneRunnerDeps.scheduleResume,
 * abaixo) e o catch do setup (issue 1 do re-review): antes só o loop de
 * publicação tratava flood como resumable — um flood durante createChannel/
 * identity/promoteBot/exportInvite matava o job via fail(), mesmo sendo
 * transitório. Centralizar aqui evita a matemática do delay divergir entre
 * os dois caminhos.
 */
async function scheduleCloneResume(cloneJobId: string, seconds: number): Promise<void> {
  const waitMs = (seconds + 5) * 1000;
  await supabase
    .from("clone_jobs")
    .update({ resume_after: new Date(Date.now() + waitMs).toISOString() })
    .eq("id", cloneJobId);
  await enqueueMtproto({ kind: "clone.run", cloneJobId }, { delayMs: waitMs });
}

/**
 * Grava um lote de linhas de rascunho. Upsert em (campaign_id, source_msg_id)
 * — ver 074: é o que torna a retomada pós-FLOOD_WAIT idempotente, coisa que o
 * clone live não tem (050).
 *
 * `reply_to_id` é resolvido aqui e não no publisher: o publisher só conhece o
 * id NA ORIGEM da mensagem respondida (é o que resolveReply devolve, porque o
 * destMsgId sintético é o próprio source id), e o uuid só existe no banco.
 */
async function upsertStagedRows(
  campaignId: string,
  tenantId: string,
  rows: StagedRow[],
): Promise<void> {
  const payload = [];
  for (const r of rows) {
    let replyToId: string | null = null;
    if (r.replyToSourceMsgId !== null) {
      const { data } = await supabase
        .from("mtproto_scheduled_messages")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("source_msg_id", r.replyToSourceMsgId)
        .maybeSingle();
      // Alvo fora do messageLimit não foi gravado: degrada pra envio sem
      // resposta, exatamente como o clone live faz quando o idMap não tem o id.
      replyToId = (data?.id as string | undefined) ?? null;
    }
    payload.push({
      campaign_id: campaignId,
      tenant_id: tenantId,
      kind: r.kind,
      content_text: r.contentText,
      media: r.media,
      entities: r.entities,
      inline_links: r.inlineLinks,
      poll: r.poll,
      file_name: r.fileName,
      position: r.position,
      source_msg_id: r.sourceMsgId,
      reply_to_id: replyToId,
    });
  }
  const { error } = await supabase
    .from("mtproto_scheduled_messages")
    .upsert(payload, { onConflict: "campaign_id,source_msg_id" });
  if (error) {
    // Sobe pro runner: uma linha perdida em silêncio vira post faltando no
    // rascunho, e o usuário não teria como saber qual.
    throw new Error(`falha ao gravar rascunho: ${error.message}`);
  }
}

/**
 * Renumera `position` como 1..N na ordem de `source_msg_id`, uma vez, no fim
 * do job. O publisher grava position=0 de propósito: calcular max+1 durante a
 * publicação abriria buraco e colisão numa retomada, que reprocessa lotes já
 * gravados.
 */
async function renumberDraftPositions(campaignId: string): Promise<number> {
  // Leitura paginada de propósito: o PostgREST corta toda resposta em
  // db.max_rows (1000 por padrão), e um select sem .range() devolveria só a
  // primeira página — renumerando parte da campanha e gravando um
  // total_messages menor que o real, em silêncio, que é o número que a tela
  // de lançamento lê depois. O teto de rascunho é menor que isso hoje, mas
  // álbum colapsa várias mensagens numa linha só e teto muda; não dá pra
  // depender disso. Ordem por source_msg_id é total (o unique da 074 proíbe
  // empate) e nada insere durante esta varredura, então a paginação é estável.
  const PAGINA = 1000;
  const rows: { id: string }[] = [];
  for (let offset = 0; ; offset += PAGINA) {
    const { data } = await supabase
      .from("mtproto_scheduled_messages")
      .select("id")
      .eq("campaign_id", campaignId)
      .order("source_msg_id", { ascending: true })
      .range(offset, offset + PAGINA - 1);
    const pagina = data ?? [];
    rows.push(...pagina);
    // Página curta (ou vazia) = acabou. Página cheia pode ter mais atrás.
    if (pagina.length < PAGINA) break;
  }
  for (let i = 0; i < rows.length; i++) {
    await supabase
      .from("mtproto_scheduled_messages")
      .update({ position: i + 1 })
      .eq("id", rows[i].id);
  }
  return rows.length;
}

export async function handleCloneRun(cloneJobId: string): Promise<void> {
  const { data: job } = await supabase
    .from("clone_jobs")
    .select("*")
    .eq("id", cloneJobId)
    .single();
  if (!job) {
    console.warn(`[clone] job ${cloneJobId} não encontrado`);
    return;
  }

  // Defeito I6a: um resume de FLOOD_WAIT agendado com delay (scheduleResume)
  // pode disparar minutos depois pra um job que o usuário já pausou (ou que
  // foi apagado/concluído/falhou) nesse meio tempo. launchClone só enfileira
  // depois de setar status='running'; scheduleResume só depois de setar
  // 'waiting_flood' — então só esses dois status autorizam rodar. Qualquer
  // outro (em especial 'paused') vira no-op silencioso: sem essa guarda, um
  // resume atrasado atropelava a pausa e o job continuava rodando.
  if (job.status !== "running" && job.status !== "waiting_flood") {
    console.log(
      `[clone] job ${cloneJobId} ignorado: status atual é '${job.status}' (esperado running/waiting_flood)`,
    );
    return;
  }

  // Defeito I6b: trava de execução por job (mesmo padrão de
  // 030_mtproto_campaign_processing_lock.sql, adaptado pra CAS numa única
  // query). Sem isso, um resume atrasado da fila e um novo launchClone (ou
  // dois workers) podem processar o mesmo job em paralelo: os dois runners
  // carregam o mesmo cursor persistido e chamam publish() — que NÃO é
  // idempotente — pro mesmo lote, duplicando posts no destino (o upsert em
  // clone_message_map só dedupa a linha do mapa, não o envio real ao
  // Telegram). Reivindica atomicamente só se ninguém segura a trava, ou se
  // ela está velha o bastante (>10min) pra presumir que o worker anterior
  // crashou sem limpar.
  // Issue 2 do re-review (TOCTOU): o status era lido uma vez lá em cima e
  // nunca revisitado até aqui — uma pausa emitida na janela entre aquela
  // leitura e este UPDATE passava batido, e o claim reivindicava a trava pra
  // um job que já não deveria rodar. Dobrar a condição de status pra DENTRO
  // do WHERE do próprio UPDATE atômico fecha a janela: claim e guarda de
  // status viram uma operação só. Se nenhuma linha voltar, ou outro worker
  // segura a trava, ou o job não é mais 'running'/'waiting_flood' (pausado,
  // concluído, apagado) — os dois casos significam "não rodar", sem
  // distinguir qual foi (a leitura de status lá em cima já serve pro log).
  const staleBefore = new Date(Date.now() - PROCESSING_CLAIM_STALE_MS).toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("clone_jobs")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", cloneJobId)
    .in("status", ["running", "waiting_flood"])
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.error(`[clone] falha ao reivindicar trava do job ${cloneJobId}: ${claimErr.message}`);
    return;
  }
  if (!claimed) {
    console.log(
      `[clone] job ${cloneJobId} não reivindicado (trava de outro worker ou status não roda mais), ignorando`,
    );
    return;
  }

  try {
    // Clone cross-account: a conta que LÊ a origem (job.account_id, dona do
    // canal) pode ser diferente da que CRIA o destino (job.dest_account_id).
    // Caso comum (dest null ou igual): as duas apontam pra mesma conta e um
    // objeto de client só, sem abrir duas conexões à toa.
    const sourceAccountId = job.account_id;
    const destAccountId = job.dest_account_id ?? job.account_id;
    const crossAccount = destAccountId !== sourceAccountId;

    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("id, session_string, status")
      .eq("id", sourceAccountId)
      .single();
    if (!account?.session_string || account.status !== "active") {
      await fail(cloneJobId, "conta MTProto de origem inativa ou sem sessão");
      return;
    }

    // Conta de destino (só carrega separado quando é cross-account).
    let destAccount = account;
    if (crossAccount) {
      const { data: da } = await supabase
        .from("mtproto_accounts")
        .select("id, session_string, status")
        .eq("id", destAccountId)
        .eq("tenant_id", job.tenant_id)
        .single();
      if (!da?.session_string || da.status !== "active") {
        await fail(cloneJobId, "conta de destino inativa ou sem sessão — escolha outra conta");
        return;
      }
      destAccount = da;
    }

    // Bot companheiro é pré-requisito obrigatório: sem ele não existe rota de
    // publicação (nem "batch"/forward, que ainda depende do bot pra promoção
    // a admin do destino), então falha o job com mensagem clara em vez de
    // seguir e quebrar mais adiante numa chamada qualquer.
    //
    // Pré-requisito só do modo live, que publica de verdade. No rascunho
    // ninguém publica nada — o bot só entra quando a campanha for lançada
    // (Plano 2), e exigi-lo aqui bloquearia um clone que não precisa dele.
    const ehRascunho = job.mode === "draft";
    const { data: botRow } = await supabase
      .from("automation_bots")
      .select("id, token, username, session_string, status")
      .eq("tenant_id", job.tenant_id)
      .single();
    if (!ehRascunho && (!botRow || botRow.status !== "active")) {
      await fail(cloneJobId, "bot companheiro não cadastrado — cadastre o token antes de clonar");
      return;
    }

    const client = new MtprotoClient(
      config.telegramApiId,
      config.telegramApiHash,
      account.session_string,
    );
    // destClient cria o canal e promove o bot. Mesma conta → mesmo objeto (não
    // reconecta à toa). Cross-account → sessão da conta de destino.
    const destClient = crossAccount
      ? new MtprotoClient(config.telegramApiId, config.telegramApiHash, destAccount.session_string)
      : client;
    const source: ClonePeer = {
      peerId: job.source_peer_id,
      peerType: job.source_peer_type,
      accessHash: job.source_peer_access_hash,
    };
    const reader = new SourceReader(client, source);
    const tmpDir = path.join(os.tmpdir(), "lionbot-clone", cloneJobId);

    // Declarado fora do try pra o finally poder desconectar mesmo se a
    // construção do bot (dentro do try) falhar antes de `runner.run()`.
    let bot: CompanionBot | null = null;

    try {
      await client.connect();
      // O rascunho não tem destino: o destClient nunca é usado ali, então
      // abrir uma segunda sessão MTProto seria desperdício e mais uma
      // superfície de flood. No live a condição é a de sempre (ehRascunho é
      // false), e o disconnect no finally usa exatamente a mesma guarda.
      if (crossAccount && !ehRascunho) await destClient.connect();

      // ── Modo rascunho: sem destino, sem tópicos, sem bot. O job só lê a
      //    origem e grava. Tudo que depende de um canal de destino
      //    (ensureDestination, syncTopics, promoção do bot, invite) não roda.
      let publish: (
        group: SourceMessage[],
        replyToDestId: number | null,
      ) => Promise<CloneOutcome[]>;
      let topicSync: Awaited<ReturnType<typeof syncTopics>> | null = null;
      let wantsForum = false;
      // `dest` só é escrito e só é lido no caminho live — os usos posteriores
      // ficam todos sob `wantsForum`, que no rascunho nunca vira true. A
      // asserção de atribuição definida mantém o tipo não-nulo dentro das
      // arrow functions de syncTopics/finalizeTopics: um `| null` ali perderia
      // o estreitamento e obrigaria a reescrever o caminho live.
      let dest!: Awaited<ReturnType<typeof ensureDestination>>;

      if (ehRascunho) {
        const campaignId = job.draft_campaign_id as string | null;
        if (!campaignId) {
          await fail(cloneJobId, "job em modo rascunho sem campanha vinculada");
          return;
        }
        const linkReplaceConfiguradoDraft = Boolean(
          job.link_replace_bot || job.link_replace_group || job.link_replace_channel,
        );

        // A estratégia sai de chooseStrategy, não de uma string cravada aqui:
        // a decisão mora numa função só, e sem esta chamada o parâmetro
        // draftMode da Task 3 ficaria testado e morto. `draftMode: true` é a
        // primeira guarda de lá, então nenhum dos outros campos muda o
        // resultado — sourceHasNoForwards vai false pra não gastar uma RPC
        // (reader.hasNoForwards) cuja resposta seria ignorada.
        const estrategiaDraft = chooseStrategy({
          requested: job.strategy,
          sourceHasNoForwards: false,
          copyButtons: job.copy_buttons,
          copyReplies: job.copy_replies,
          crossAccount: false,
          linkReplaceConfigured: linkReplaceConfiguradoDraft,
          draftMode: true,
        });
        await supabase
          .from("clone_jobs")
          .update({ effective_strategy: estrategiaDraft })
          .eq("id", cloneJobId);
        publish = createDraftPublisher({
          rehost: async (raw, hint, fileName) =>
            downloadAndRehostMedia(
              { raw: client.raw, supabase },
              {
                media: raw.media,
                tenantId: job.tenant_id,
                jobId: cloneJobId,
                nodeIdHint: hint,
                fileName,
                tmpDir,
                maxBytes: MAX_FILE_BYTES,
                keyPrefix: "campaign",
              },
            ),
          upsert: (rows) => upsertStagedRows(campaignId, job.tenant_id, rows),
          planInput: (raw, copyPolls) => SourceReader.mediaPlanInput(raw, copyPolls),
          extractInlineLinks: (raw) => SourceReader.extractInlineLinks(raw),
          pollData: (raw) => SourceReader.pollData(raw),
          originalFileName: (raw) => SourceReader.originalFileName(raw),
          copyPolls: job.copy_polls,
          copyButtons: job.copy_buttons,
          rewrite: linkReplaceConfiguradoDraft
            ? (input) =>
                rewriteMessageLinks(
                  input,
                  {
                    classify: (identifier: string) => {
                      const parsed = parseLinkIdentifier(identifier);
                      return parsed
                        ? client.classifyLink(parsed)
                        : Promise.resolve("unknown" as PeerKind);
                    },
                  },
                  {
                    botUsername: job.link_replace_bot ?? undefined,
                    groupLink: job.link_replace_group ?? undefined,
                    channelLink: job.link_replace_channel ?? undefined,
                  },
                )
            : null,
        });
      } else {
        // 0) Fórum: grupo legacy (peerType "chat") nunca é fórum — Topics só
        // existe em supergrupo. Recalculado do zero em toda execução (mesmo
        // idioma de effective_strategy, mais abaixo) e persistido só pro
        // dashboard; nunca é lido de volta pra decidir fluxo.
        const sourceIsForum = source.peerType === "channel" && (await reader.isForum());
        await supabase
          .from("clone_jobs")
          .update({ source_is_forum: sourceIsForum })
          .eq("id", cloneJobId);
        // Fórum só existe em supergrupo — Api.Channel.forum nunca é true sem
        // megagroup no Telegram, e deriveDestKind já garante isso pro lado da
        // origem; o check aqui é defensivo (ex.: dest_kind desatualizado), não
        // a fonte de verdade.
        wantsForum = sourceIsForum && job.dest_kind === "megagroup";

        // 1) Destino (idempotente na retomada — ensureDestination devolve
        // `existing` direto se o job já tiver dest_channel_id persistido, mas
        // sempre repromove o bot: ver defeito I4 em dest-builder.ts).
        // A LEITURA da identidade usa o client de ORIGEM (reader); a CRIAÇÃO
        // (canal, about, foto, promoção do bot, invite) usa o destClient.
        dest = await ensureDestination(
          {
            readIdentity: () => reader.readIdentity(),
            createChannel: async (title, about, opts) => {
              const created = await destClient.createChannel(title, about, opts);
              // CreateChannel deu certo → a conta de destino NÃO está restrita.
              // Limpa o flag reativo (ela pode ter sido marcada num job antigo).
              await supabase
                .from("mtproto_accounts")
                .update({ create_restricted: false })
                .eq("id", destAccountId);
              return created;
            },
            setAbout: (cid, hash, about) => destClient.setChannelAbout(cid, hash, about),
            setPhoto: (cid, hash, photo) => destClient.setChannelPhoto(cid, hash, photo),
            promoteBot: (cid, hash, username) => promoteBotTolerant(destClient, cid, hash, username),
            exportInvite: (cid, hash) => destClient.exportChannelInvite(cid, hash),
            // Chamado até 2x por job: uma vez logo após createChannel (com
            // inviteLink: null, pra retomada não recriar o canal e queimar
            // outra unidade da cota diária de CreateChannel) e outra no final
            // com o link pronto. Um UPDATE idempotente cobre as duas.
            persist: async (id, d) => {
              await supabase
                .from("clone_jobs")
                .update({
                  dest_channel_id: d.channelId,
                  dest_access_hash: d.accessHash,
                  dest_invite_link: d.inviteLink,
                })
                .eq("id", id);
            },
          },
          {
            jobId: cloneJobId,
            source,
            destKind: job.dest_kind,
            destTitle: job.dest_title,
            copyIdentity: job.copy_identity,
            botUsername: botRow!.username,
            forum: wantsForum,
            existing: job.dest_channel_id
              ? {
                  channelId: job.dest_channel_id,
                  accessHash: job.dest_access_hash,
                  inviteLink: job.dest_invite_link,
                }
              : null,
          },
        );

        // 1b) Tópicos de fórum: cria no destino os que faltam e monta o mapa
        // origem->destino ANTES de qualquer publicação (createPublisher
        // precisa do mapa pronto pra rotear cada grupo pro tópico certo).
        // Igual à promoção do bot, roda inteiro dentro do try de setup — um
        // FLOOD_WAIT aqui sobe pro catch de baixo, que já sabe agendar
        // retomada em vez de falhar o job (syncTopics relança flood de
        // propósito, ver topic-sync.ts).
        if (wantsForum) {
          topicSync = await syncTopics(
            {
              listSourceTopics: () => reader.listTopics(),
              createDestTopic: (topicInput) =>
                destClient.createForumTopic(dest.channelId, dest.accessHash, topicInput),
              setClosed: (topicId, closed) =>
                destClient.setForumTopicClosed(dest.channelId, dest.accessHash, topicId, closed),
              setPinned: (topicId, pinned) =>
                destClient.setForumTopicPinned(dest.channelId, dest.accessHash, topicId, pinned),
              loadExisting: async (id) => {
                const { data } = await supabase
                  .from("clone_topic_map")
                  .select("source_topic_id, dest_topic_id, title, status, reason")
                  .eq("job_id", id);
                return (data ?? []).map(
                  (r): CloneTopicMapRow => ({
                    sourceTopicId: Number(r.source_topic_id),
                    destTopicId: r.dest_topic_id === null ? null : Number(r.dest_topic_id),
                    title: r.title,
                    status: r.status,
                    reason: r.reason,
                  }),
                );
              },
              persist: async (id, row) => {
                // upsert, não insert: um tópico 'failed' é retentado a cada
                // resume (ver topic-sync.ts) — sem onConflict, a 2ª tentativa
                // bateria na unique (job_id, source_topic_id) da 1ª.
                await supabase.from("clone_topic_map").upsert(
                  {
                    job_id: id,
                    source_topic_id: row.sourceTopicId,
                    dest_topic_id: row.destTopicId,
                    title: row.title,
                    status: row.status,
                    reason: row.reason,
                  },
                  { onConflict: "job_id,source_topic_id" },
                );
              },
            },
            { jobId: cloneJobId },
          );
        }

        // 2) Estratégia
        const linkReplaceConfigured = Boolean(
          job.link_replace_bot || job.link_replace_group || job.link_replace_channel,
        );
        const strategy = chooseStrategy({
          requested: job.strategy,
          sourceHasNoForwards: await reader.hasNoForwards(),
          copyButtons: job.copy_buttons,
          // Defeito I5: sem isso, "copiar respostas" ligado escolhia a rota
          // batch/forward (que não carrega reply_to), e o runner calculava o
          // replyToDestId à toa — descartado em silêncio no forward.
          copyReplies: job.copy_replies,
          // Cross-account: forward entre sessões diferentes não existe → download.
          crossAccount,
          // Troca de link: ForwardMessages copia server-side, o app nunca vê
          // texto/entities nessa rota — impossível trocar link ali.
          linkReplaceConfigured,
        });
        await supabase
          .from("clone_jobs")
          .update({ effective_strategy: strategy })
          .eq("id", cloneJobId);
        if (linkReplaceConfigured) {
          console.log(
            `[clone] job ${cloneJobId}: troca de link ativada — RPCs extras de resolução podem alongar o tempo total do clone`,
          );
        }

        // 3) Bot publicador. Creds injetadas (não importadas de config.ts dentro
        // de bot-client.ts) — só usadas de fato se bot.mtproto() for chamado;
        // aqui vêm do config.ts do worker, que já garante as envs carregadas.
        bot = new CompanionBot(
          botRow!.token,
          CompanionBot.destChatIdFromChannelId(dest.channelId),
          botRow!.session_string,
          { apiId: config.telegramApiId, apiHash: config.telegramApiHash },
        );

        // Resolve pela conta de LEITURA (mesma que lê a origem) — nunca pelo
        // bot nem pela conta de destino. classify() nunca lança pra erro
        // não-flood (client.classifyLink já degrada pra "unknown"); flood
        // propaga e é pego pelo catch já existente do CloneRunner.flush().
        const linkReplace = linkReplaceConfigured
          ? {
              classify: (identifier: string): Promise<PeerKind> => {
                const parsed = parseLinkIdentifier(identifier);
                return parsed ? client.classifyLink(parsed) : Promise.resolve("unknown" as PeerKind);
              },
              values: {
                botUsername: job.link_replace_bot ?? undefined,
                groupLink: job.link_replace_group ?? undefined,
                channelLink: job.link_replace_channel ?? undefined,
              },
            }
          : null;

        publish = createPublisher({
          reader,
          bot,
          destChannelId: dest.channelId,
          destAccessHash: dest.accessHash,
          strategy,
          copyPolls: job.copy_polls,
          copyButtons: job.copy_buttons,
          tmpDir,
          topicMap: topicSync?.topicMap ?? null,
          linkReplace,
        });
      }

      // Defeito I8: "últimas N mensagens" tem que clonar as N mais NOVAS, não
      // as N mais antigas. O runner só sabe iterar em ordem ascendente (pra
      // manter a retomada pelo cursor), então em vez de mudar a direção,
      // calculamos um PISO: o menor id entre as N mensagens mais recentes.
      // A iteração ascendente passa a começar dali (perto do fim do
      // histórico) em vez do início — composto com o cursor já persistido
      // via Math.max logo abaixo, então uma retomada que já avançou o
      // cursor além do piso ignora o piso (o cursor já domina o max).
      const lastNFloor = job.message_limit
        ? await reader.floorForLastN(job.message_limit)
        : 0;

      // 4) Runner
      const runner = new CloneRunner(
        {
          // READ_THROTTLE_MS é a pausa entre *leituras* (paginação do
          // histórico) — fixa e independente do throttle_ms do job, que é a
          // pausa entre *publicações* e só é usada em cfg.throttleMs abaixo.
          iterate: (since) =>
            iterHistoryAscending(reader.historySource(), {
              sinceMsgId: Math.max(since, lastNFloor > 0 ? lastNFloor - 1 : 0),
              throttleMs: READ_THROTTLE_MS,
            }),
          publish,
          persist: async (id, rows, cursor) => {
            if (rows.length > 0) {
              await supabase.from("clone_message_map").upsert(
                rows.map((r: CloneMapRow) => ({
                  job_id: id,
                  source_msg_id: r.sourceMsgId,
                  dest_msg_id: r.destMsgId,
                  grouped_id: r.groupedId,
                  status: r.status,
                  reason: r.reason,
                })),
                { onConflict: "job_id,source_msg_id" },
              );
            }
            await supabase
              .from("clone_jobs")
              .update({ cursor_source_msg_id: cursor })
              .eq("id", id);
          },
          loadIdMap: async (id) => {
            const { data } = await supabase
              .from("clone_message_map")
              .select("source_msg_id, dest_msg_id")
              .eq("job_id", id)
              .eq("status", "copied");
            return (data ?? [])
              .filter((r) => r.dest_msg_id !== null)
              .map((r) => [Number(r.source_msg_id), Number(r.dest_msg_id)] as [number, number]);
          },
          // O runner é reconstruído do zero a cada retomada (ex.: pós
          // FLOOD_WAIT) — sem repopular os contadores aqui, o progresso
          // reportado voltaria a zero e o messageLimit recomeçaria a contar
          // (job com limite 500 que já copiou 400 copiaria mais 500).
          loadCounters: async (id) => {
            // count-only (head: true, sem baixar linhas) — quatro contagens
            // pequenas em paralelo é mais barato que puxar todas as linhas do
            // job pra tally em JS num canal com dezenas de milhares de mensagens.
            const countOf = (status?: "copied" | "skipped" | "failed") => {
              let q = supabase
                .from("clone_message_map")
                .select("*", { count: "exact", head: true })
                .eq("job_id", id);
              if (status) q = q.eq("status", status);
              return q;
            };
            const [seen, copied, skipped, failed] = await Promise.all([
              countOf(),
              countOf("copied"),
              countOf("skipped"),
              countOf("failed"),
            ]);
            return {
              copied: copied.count ?? 0,
              skipped: skipped.count ?? 0,
              failed: failed.count ?? 0,
              seen: seen.count ?? 0,
            };
          },
          getStatus: async (id) => {
            const { data } = await supabase
              .from("clone_jobs")
              .select("status")
              .eq("id", id)
              .maybeSingle();
            return data?.status ?? null;
          },
          setStatus: async (id, status: CloneStatus, patch) => {
            // Escreve transições de status observáveis do job (running, waiting_flood,
            // completed, failed) — o que o dashboard lê na polling. Falha silenciosa
            // aqui deixa o job travado num estado antigo, sem notificação do operador.
            // Log permite rastrear se a escrita falhou para esse job e status.
            const { error: writeError } = await supabase
              .from("clone_jobs")
              .update({
                status,
                copied_count: patch.copiedCount,
                skipped_count: patch.skippedCount,
                failed_count: patch.failedCount,
                total_seen: patch.totalSeen,
                last_error: patch.lastError ?? null,
                ...(status === "running" ? { started_at: new Date().toISOString() } : {}),
                ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
              })
              .eq("id", id);
            if (writeError) {
              console.error(
                `[clone] falha ao gravar status=${status} do job ${id}: ${writeError.message}`
              );
            }
          },
          // Defeito I3: heartbeat de progresso. Chamado ao fim de cada
          // flush() — grava SÓ as 4 colunas de contagem, nunca status nem
          // started_at, pra não poder resetar uma transição escrita por
          // setStatus. Sem isso a barra de progresso do dashboard (polling
          // em /api/clones/[cloneId]) fica travada em 0% a run inteira e
          // pula pra 100% só no final.
          heartbeat: async (id, counters) => {
            const { error: writeError } = await supabase
              .from("clone_jobs")
              .update({
                copied_count: counters.copiedCount,
                skipped_count: counters.skippedCount,
                failed_count: counters.failedCount,
                total_seen: counters.totalSeen,
              })
              .eq("id", id);
            if (writeError) {
              console.warn(`[clone] heartbeat falhou pro job ${id}: ${writeError.message}`);
            }
          },
          scheduleResume: (id, seconds) => scheduleCloneResume(id, seconds),
          sourcePinnedIds: () => reader.pinnedIds(),
          pinInDest: async (ids) => {
            if (ehRascunho) {
              // Sem destino pra fixar: marca a linha, e o worker de disparo
              // chama bot.pin() depois de publicar de verdade.
              const campaignId = job.draft_campaign_id as string;
              await supabase
                .from("mtproto_scheduled_messages")
                .update({ is_pinned: true })
                .eq("campaign_id", campaignId)
                .in("source_msg_id", ids);
              return;
            }
            for (const id of ids) {
              await bot!.pin(id).catch((err) => console.warn("[clone] pin falhou:", err));
            }
          },
          delay: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
        {
          jobId: cloneJobId,
          messageLimit: job.message_limit,
          throttleMs: job.throttle_ms,
          copyReplies: job.copy_replies,
          copyPins: job.copy_pins,
          copyButtons: job.copy_buttons,
          copyPolls: job.copy_polls,
        },
      );

      await runner.run();

      // Rascunho: renumera as posições e leva a campanha pro estado certo.
      // Releitura fresca do status pelo mesmo motivo do finalizeTopics abaixo:
      // run() também retorna em pausa, flood e falha.
      if (ehRascunho) {
        const { data: finalRow } = await supabase
          .from("clone_jobs")
          .select("status")
          .eq("id", cloneJobId)
          .maybeSingle();
        if (finalRow?.status === "completed") {
          const campaignId = job.draft_campaign_id as string;
          const total = await renumberDraftPositions(campaignId);
          const querIa = job.ai_clean || job.ai_rewrite || job.ai_smart_delay;
          // A escrita (com CAS de estado) e o enfileiramento da IA moram em
          // draft-finalize.ts pra serem testáveis sem montar meio worker.
          await finalizarCampanhaDoRascunho(campaignId, total, querIa);
        }
      }

      // Fecha/fixa tópicos só depois de confirmar (releitura fresca, não o
      // simples retorno de run() — que também acontece em pausa/flood/falha)
      // que o job chegou a 'completed' de verdade. Ver o porquê em
      // topic-sync.ts: fechar um tópico antes de terminar de publicar nele
      // arriscaria bloquear posts futuros do bot mesmo sendo admin.
      // Guarda explícita do invariante que a asserção de atribuição definida
      // de `dest` promete mas o compilador não checa: fórum só existe no
      // caminho live, e lá `dest` sempre foi atribuído antes daqui.
      // Inalcançável hoje — no rascunho `wantsForum` nunca deixa de ser false.
      //
      // DEGRADA, não lança: finalizar tópicos já é deliberadamente não-fatal
      // aqui (ver o .catch logo abaixo, que só avisa). Um throw contradiria
      // isso e viraria um clone que TERMINOU num job 'failed' no dashboard —
      // pior que o `undefined.channelId` que a guarda evita, porque apagaria
      // um resultado verdadeiro. Perder a fixação/fechamento dos tópicos é
      // perda menor que reportar como falho um job que deu certo. O nome
      // DESTINO_AUSENTE_NO_FINALIZE é a alça de grep no log.
      if (wantsForum && topicSync && !dest) {
        console.error(
          `[clone] DESTINO_AUSENTE_NO_FINALIZE: job ${cloneJobId} chegou à finalização de tópicos sem destino — invariante do modo live quebrada, finalização pulada (o job mantém o status real)`,
        );
      }
      if (wantsForum && topicSync && dest) {
        const { data: finalRow } = await supabase
          .from("clone_jobs")
          .select("status")
          .eq("id", cloneJobId)
          .maybeSingle();
        if (finalRow?.status === "completed") {
          await finalizeTopics(
            {
              setClosed: (topicId, closed) =>
                destClient.setForumTopicClosed(dest.channelId, dest.accessHash, topicId, closed),
              setPinned: (topicId, pinned) =>
                destClient.setForumTopicPinned(dest.channelId, dest.accessHash, topicId, pinned),
            },
            topicSync.topicMap,
            topicSync.sourceTopics,
          ).catch((err) =>
            console.warn(`[clone] finalizeTopics falhou pro job ${cloneJobId} (não fatal):`, err),
          );
        }
      }
    } catch (err) {
      // Issue 1 do re-review: a promoção do bot passou a rodar em TODA
      // retomada (defeito I4, ver ensureDestination/promoteBotTolerant acima),
      // e as RPCs de admin extras (InviteToChannel/EditAdmin) podem disparar
      // FLOOD_WAIT mesmo numa repromoção redundante. O loop de publicação
      // (CloneRunner.run) já sabe agendar retomada em vez de falhar num
      // flood — mas esse catch aqui, que cobre todo o setup (createChannel,
      // identity, promote, invite export), até então SÓ sabia fail(). Um
      // flood transitório no setup de um resume matava permanentemente um
      // job saudável no meio da clonagem. Tratamos igual ao runner: flood
      // → waiting_flood + scheduleCloneResume; qualquer
      // outro erro (BOT_GROUPS_BLOCKED, RIGHT_FORBIDDEN, erro de DB, etc.)
      // continua genuíno e fatal.
      const wait = extractWaitSeconds(err);
      if (wait !== null) {
        console.warn(
          `[clone] job ${cloneJobId} flood durante o setup (${wait}s), agendando retomada em vez de falhar`,
        );
        await supabase
          .from("clone_jobs")
          .update({ status: "waiting_flood", last_error: `flood_wait_${wait}s` })
          .eq("id", cloneJobId);
        await scheduleCloneResume(cloneJobId, wait);
      } else {
        // USER_RESTRICTED no createChannel: a conta de destino está limitada
        // pelo Telegram (anti-spam) e não cria canais. Marca reativamente pra
        // ela sumir do seletor de "criar destino em" nos próximos clones.
        if (isUserRestricted(err)) {
          await supabase
            .from("mtproto_accounts")
            .update({ create_restricted: true })
            .eq("id", destAccountId)
            .then(undefined, () => {});
        }
        console.error(`[clone] job ${cloneJobId} falhou:`, err);
        await fail(cloneJobId, err instanceof Error ? err.message : String(err));
      }
    } finally {
      await bot?.disconnect().catch(() => {});
      await client.disconnect().catch(() => {});
      // destClient só é objeto separado no cross-account; senão é o mesmo
      // `client` já desconectado acima.
      // A guarda é idêntica à do connect lá em cima — desconecta exatamente o
      // que foi aberto, e no rascunho não foi aberto nada.
      if (crossAccount && !ehRascunho) await destClient.disconnect().catch(() => {});
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    // Libera a trava de processamento (defeito I6b) — sempre, mesmo nos
    // retornos antecipados acima (conta/bot inativos). Sem isso um job que
    // falhou cedo ficaria travado até o TTL de 10min estourar.
    await supabase
      .from("clone_jobs")
      .update({ processing_started_at: null })
      .eq("id", cloneJobId);
  }
}

async function fail(cloneJobId: string, error: string): Promise<void> {
  // Escreve o estado terminal (failed) do job — falha silenciosa aqui deixa
  // o job travado como running no dashboard, sem nenhum trace. Log permite
  // que o operador localize em analytics se a escrita falhou.
  const { error: writeError } = await supabase
    .from("clone_jobs")
    .update({ status: "failed", last_error: error })
    .eq("id", cloneJobId);
  if (writeError) {
    console.error(
      `[clone] falha ao marcar job ${cloneJobId} como failed: ${writeError.message}`
    );
  }
}
