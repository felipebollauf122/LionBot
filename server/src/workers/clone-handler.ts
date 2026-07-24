// Fio de integração da clonagem (Task 11): carrega o job, a conta MTProto e o
// bot companheiro do Supabase, monta o destino, escolhe a estratégia e injeta
// implementações reais em cada dependência do CloneRunner (Tasks 4-10).
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { MtprotoClient } from "../services/mtproto/client.js";
import { CompanionBot } from "../services/mtproto/clone/bot-client.js";
import {
  SourceReader,
  READ_THROTTLE_MS,
} from "../services/mtproto/clone/source-reader.js";
import { ensureDestination } from "../services/mtproto/clone/dest-builder.js";
import {
  chooseStrategy,
  createPublisher,
} from "../services/mtproto/clone/publish-router.js";
import { iterHistoryAscending } from "../services/mtproto/clone/history-iterator.js";
import { CloneRunner } from "../services/mtproto/clone/clone-runner.js";
import { enqueueMtproto } from "../queue-mtproto.js";
import { extractWaitSeconds } from "../services/mtproto/flood.js";
import type {
  CloneMapRow,
  CloneStatus,
  ClonePeer,
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
    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("id, session_string, status")
      .eq("id", job.account_id)
      .single();
    if (!account?.session_string || account.status !== "active") {
      await fail(cloneJobId, "conta MTProto inativa ou sem sessão");
      return;
    }

    // Bot companheiro é pré-requisito obrigatório: sem ele não existe rota de
    // publicação (nem "batch"/forward, que ainda depende do bot pra promoção
    // a admin do destino), então falha o job com mensagem clara em vez de
    // seguir e quebrar mais adiante numa chamada qualquer.
    const { data: botRow } = await supabase
      .from("automation_bots")
      .select("id, token, username, session_string, status")
      .eq("tenant_id", job.tenant_id)
      .single();
    if (!botRow || botRow.status !== "active") {
      await fail(cloneJobId, "bot companheiro não cadastrado — cadastre o token antes de clonar");
      return;
    }

    const client = new MtprotoClient(
      config.telegramApiId,
      config.telegramApiHash,
      account.session_string,
    );
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

      // 1) Destino (idempotente na retomada — ensureDestination devolve
      // `existing` direto se o job já tiver dest_channel_id persistido, mas
      // sempre repromove o bot: ver defeito I4 em dest-builder.ts).
      const dest = await ensureDestination(
        {
          readIdentity: () => reader.readIdentity(),
          createChannel: (title, about, opts) => client.createChannel(title, about, opts),
          setAbout: (cid, hash, about) => client.setChannelAbout(cid, hash, about),
          setPhoto: (cid, hash, photo) => client.setChannelPhoto(cid, hash, photo),
          promoteBot: (cid, hash, username) => promoteBotTolerant(client, cid, hash, username),
          exportInvite: (cid, hash) => client.exportChannelInvite(cid, hash),
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
          botUsername: botRow.username,
          existing: job.dest_channel_id
            ? {
                channelId: job.dest_channel_id,
                accessHash: job.dest_access_hash,
                inviteLink: job.dest_invite_link,
              }
            : null,
        },
      );

      // 2) Estratégia
      const strategy = chooseStrategy({
        requested: job.strategy,
        sourceHasNoForwards: await reader.hasNoForwards(),
        copyButtons: job.copy_buttons,
        // Defeito I5: sem isso, "copiar respostas" ligado escolhia a rota
        // batch/forward (que não carrega reply_to), e o runner calculava o
        // replyToDestId à toa — descartado em silêncio no forward.
        copyReplies: job.copy_replies,
      });
      await supabase
        .from("clone_jobs")
        .update({ effective_strategy: strategy })
        .eq("id", cloneJobId);

      // 3) Bot publicador. Creds injetadas (não importadas de config.ts dentro
      // de bot-client.ts) — só usadas de fato se bot.mtproto() for chamado;
      // aqui vêm do config.ts do worker, que já garante as envs carregadas.
      bot = new CompanionBot(
        botRow.token,
        CompanionBot.destChatIdFromChannelId(dest.channelId),
        botRow.session_string,
        { apiId: config.telegramApiId, apiHash: config.telegramApiHash },
      );

      const publish = createPublisher({
        reader,
        bot,
        destChannelId: dest.channelId,
        destAccessHash: dest.accessHash,
        strategy,
        copyPolls: job.copy_polls,
        copyButtons: job.copy_buttons,
        tmpDir,
      });

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
        console.error(`[clone] job ${cloneJobId} falhou:`, err);
        await fail(cloneJobId, err instanceof Error ? err.message : String(err));
      }
    } finally {
      await bot?.disconnect().catch(() => {});
      await client.disconnect().catch(() => {});
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
