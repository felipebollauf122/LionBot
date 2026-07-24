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
import type {
  CloneMapRow,
  CloneStatus,
  ClonePeer,
} from "../services/mtproto/clone/types.js";

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
    // `existing` direto se o job já tiver dest_channel_id persistido).
    const dest = await ensureDestination(
      {
        readIdentity: () => reader.readIdentity(),
        createChannel: (title, about, opts) => client.createChannel(title, about, opts),
        setAbout: (cid, hash, about) => client.setChannelAbout(cid, hash, about),
        setPhoto: (cid, hash, photo) => client.setChannelPhoto(cid, hash, photo),
        promoteBot: (cid, hash, username) => client.promoteBotToAdmin(cid, hash, username),
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

    // 4) Runner
    const runner = new CloneRunner(
      {
        // READ_THROTTLE_MS é a pausa entre *leituras* (paginação do
        // histórico) — fixa e independente do throttle_ms do job, que é a
        // pausa entre *publicações* e só é usada em cfg.throttleMs abaixo.
        iterate: (since) =>
          iterHistoryAscending(reader.historySource(), {
            sinceMsgId: since,
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
        scheduleResume: async (id, seconds) => {
          // +5s de folga sobre o que o Telegram pediu. O job volta pela fila
          // com delay real: reenfileirar na hora giraria em loop no mesmo flood.
          const waitMs = (seconds + 5) * 1000;
          await supabase
            .from("clone_jobs")
            .update({ resume_after: new Date(Date.now() + waitMs).toISOString() })
            .eq("id", id);
          await enqueueMtproto({ kind: "clone.run", cloneJobId: id }, { delayMs: waitMs });
        },
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
    console.error(`[clone] job ${cloneJobId} falhou:`, err);
    await fail(cloneJobId, err instanceof Error ? err.message : String(err));
  } finally {
    await bot?.disconnect().catch(() => {});
    await client.disconnect().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
