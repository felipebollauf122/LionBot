// Fio de integração da clonagem de fluxo de bot: carrega o job/conta do
// Supabase e injeta implementações reais de I/O (MTProto + Storage) em cada
// dependência do BotExplorer (pure/testado em bot-clone/explorer.ts). Espelha
// clone-handler.ts (CAS lock, resume por FLOOD_WAIT, cleanup de tmpDir).
import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import { Api, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import bigInt from "big-integer";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { MtprotoClient } from "../services/mtproto/client.js";
import {
  BotExplorer,
  type BotExplorerDeps,
  type ExistingNode,
  type NodeStatus,
  type PersistedButton,
  type PersistedMessage,
  type PersistNodeInput,
  type RawCapturedMessage,
} from "../services/mtproto/bot-clone/explorer.js";
import { clickCallbackButton } from "../services/mtproto/bot-clone/click-button.js";
import { downloadAndRehostMedia } from "../services/mtproto/bot-clone/media-rehost.js";
import { gramjsEntitiesToCaptured, type CapturedEntity } from "../services/mtproto/bot-clone/entities-to-html.js";
import { mapRawButton } from "../services/mtproto/bot-clone/payment-guard.js";
import { buildFlowGraph, type CapturedNodeForFlow } from "../services/mtproto/bot-clone/transcript-to-flow.js";
import { planForMessage } from "../services/mtproto/clone/media-plan.js";
import { SourceReader } from "../services/mtproto/clone/source-reader.js";
import { MAX_FILE_BYTES } from "../services/mtproto/clone/publish-router.js";
import { enqueueMtproto } from "../queue-mtproto.js";
import { extractWaitSeconds } from "../services/mtproto/flood.js";

/** Janela de obsolescência da trava de processamento — mesmo valor de clone-handler.ts. */
const PROCESSING_CLAIM_STALE_MS = 10 * 60 * 1000;

/** Silêncio que fecha um burst de resposta; teto absoluto por burst. */
const BURST_SILENCE_MS = 8_000;
const BURST_CAP_MS = 20_000;

/** Intervalo do poll de remarketing (§5 do plano). */
const REMARKETING_POLL_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers de mapeamento DB <-> shapes puros de explorer.ts/transcript-to-flow.ts
// ---------------------------------------------------------------------------

function mapStoredButton(b: Record<string, unknown>): PersistedButton {
  return {
    id: String(b.id),
    kind: b.kind as PersistedButton["kind"],
    label: String(b.label ?? ""),
    url: (b.url as string | null) ?? null,
    data: (b.data as string | null) ?? null,
    skip: Boolean(b.skip),
    skipReason: (b.skip_reason as string | null) ?? null,
    paymentDomainMatch: Boolean(b.payment_domain_match),
  };
}

function mapStoredMessage(m: Record<string, unknown>): PersistedMessage {
  return {
    seq: Number(m.seq ?? 0),
    rawMsgId: Number(m.raw_msg_id ?? 0),
    text: (m.text as string | null) ?? null,
    entities: (m.entities as CapturedEntity[] | null) ?? [],
    mediaKind: String(m.media_kind ?? "none"),
    mediaPublicUrl: (m.media_public_url as string | null) ?? null,
    buttons: ((m.buttons as Record<string, unknown>[] | null) ?? []).map(mapStoredButton),
  };
}

function serializeButton(b: PersistedButton) {
  return {
    id: b.id,
    kind: b.kind,
    label: b.label,
    url: b.url,
    data: b.data,
    skip: b.skip,
    skip_reason: b.skipReason,
    payment_domain_match: b.paymentDomainMatch,
  };
}

function serializeMessage(m: PersistedMessage) {
  return {
    seq: m.seq,
    raw_msg_id: m.rawMsgId,
    text: m.text,
    entities: m.entities,
    media_kind: m.mediaKind,
    media_public_url: m.mediaPublicUrl,
    buttons: m.buttons.map(serializeButton),
  };
}

/** Classifica a mídia crua de uma Api.Message reaproveitando media-plan.ts (mesma lógica do clonador de canal). */
function classifyRawMedia(msg: Api.Message): { mediaKind: string; media: unknown; fileName: string | null } {
  const mediaClassName = msg.media ? msg.media.className : null;
  const attrs =
    msg.media instanceof Api.MessageMediaDocument && msg.media.document instanceof Api.Document
      ? msg.media.document.attributes.map((a) => a.className)
      : [];
  const plan = planForMessage({
    mediaClassName,
    documentAttributeClassNames: attrs,
    hasText: Boolean(msg.message && msg.message.trim()),
    copyPolls: false,
  });
  if (plan.kind === "media") {
    return { mediaKind: plan.mediaKind, media: msg.media, fileName: SourceReader.originalFileName(msg) ?? `file_${msg.id}` };
  }
  if (plan.kind === "poll") return { mediaKind: "poll", media: null, fileName: null };
  // "text" (sem mídia real, ou webpage preview) ou "skip" (giveaway/invoice/
  // story/etc — plan.reason vira o media_kind pra não perder o rastro no
  // nó unmapped que a reconstrução do fluxo vai gerar pra isso).
  return { mediaKind: plan.kind === "skip" ? plan.reason : "none", media: null, fileName: null };
}

function extractRawButtons(msg: Api.Message): Api.TypeKeyboardButton[] {
  const markup = msg.replyMarkup;
  if (!(markup instanceof Api.ReplyInlineMarkup) && !(markup instanceof Api.ReplyKeyboardMarkup)) return [];
  const out: Api.TypeKeyboardButton[] = [];
  for (const row of markup.rows) for (const btn of row.buttons) out.push(btn);
  return out;
}

/**
 * Espera mensagens novas do bot-alvo até `BURST_SILENCE_MS` de silêncio (ou
 * `BURST_CAP_MS` no total) e devolve o burst já no shape que BotExplorer
 * espera. Um listener por chamada — registrado e removido dentro da própria
 * promise, nunca compartilhado entre chamadas concorrentes (a exploração é
 * sempre sequencial: um burst por vez).
 */
function captureBurstFromBot(rawClient: TelegramClient, botPeerId: string): Promise<RawCapturedMessage[]> {
  return new Promise((resolve) => {
    const collected: Api.Message[] = [];
    let silenceTimer: NodeJS.Timeout;
    let capTimer: NodeJS.Timeout;
    let done = false;
    const filter = new NewMessage({});

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(silenceTimer);
      clearTimeout(capTimer);
      rawClient.removeEventHandler(handler, filter);
      collected.sort((a, b) => a.id - b.id);
      resolve(
        collected.map((m) => {
          const { mediaKind, media, fileName } = classifyRawMedia(m);
          return {
            rawMsgId: m.id,
            text: m.message || null,
            entities: m.entities,
            mediaKind,
            media,
            fileName,
            rawButtons: extractRawButtons(m),
          };
        }),
      );
    };
    const resetSilence = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(finish, BURST_SILENCE_MS);
    };
    const handler = async (event: NewMessageEvent): Promise<void> => {
      const msg = event.message;
      if (!msg || !(msg instanceof Api.Message) || msg.out) return;
      const sender = msg.peerId;
      const fromId = sender instanceof Api.PeerUser ? sender.userId.toString() : null;
      if (fromId !== botPeerId) return;
      collected.push(msg);
      resetSilence();
    };

    rawClient.addEventHandler(handler, filter);
    resetSilence();
    capTimer = setTimeout(finish, BURST_CAP_MS);
  });
}

async function resolveTargetBot(
  client: MtprotoClient,
  username: string,
): Promise<{ peerId: string; accessHash: string } | null> {
  const result = await client.raw.invoke(new Api.contacts.ResolveUsername({ username }));
  const peer = result.peer;
  if (!(peer instanceof Api.PeerUser)) return null;
  const targetId = String(peer.userId);
  const user = result.users.find((u): u is Api.User => u instanceof Api.User && String(u.id) === targetId);
  if (!user || !user.bot || !user.accessHash) return null;
  return { peerId: String(user.id), accessHash: String(user.accessHash) };
}

async function fail(cloneJobId: string, error: string): Promise<void> {
  const { error: writeError } = await supabase
    .from("bot_clone_jobs")
    .update({ status: "failed", last_error: error })
    .eq("id", cloneJobId);
  if (writeError) {
    console.error(`[botclone] falha ao marcar job ${cloneJobId} como failed: ${writeError.message}`);
  }
}

async function scheduleExploreResume(cloneJobId: string, seconds: number): Promise<void> {
  const waitMs = (seconds + 5) * 1000;
  await supabase
    .from("bot_clone_jobs")
    .update({ resume_after: new Date(Date.now() + waitMs).toISOString() })
    .eq("id", cloneJobId);
  await enqueueMtproto({ kind: "botclone.explore", cloneJobId }, { delayMs: waitMs });
}

async function loadExistingNodes(jobId: string): Promise<ExistingNode[]> {
  const { data } = await supabase.from("bot_clone_nodes").select("*").eq("job_id", jobId);
  return (data ?? []).map((row) => ({
    id: row.id,
    fingerprint: row.fingerprint,
    status: row.status as NodeStatus,
    parentNodeId: row.parent_node_id,
    triggeredByButtonId: row.triggered_by_button_id,
    depth: row.depth,
    messages: ((row.messages as Record<string, unknown>[] | null) ?? []).map(mapStoredMessage),
  }));
}

// ---------------------------------------------------------------------------
// handleBotCloneExplore
// ---------------------------------------------------------------------------

export async function handleBotCloneExplore(cloneJobId: string): Promise<void> {
  const { data: job } = await supabase.from("bot_clone_jobs").select("*").eq("id", cloneJobId).single();
  if (!job) {
    console.warn(`[botclone] job ${cloneJobId} não encontrado`);
    return;
  }

  // Mesma guarda de clone-handler.ts: só roda em status que autorizam
  // exploração. Um resume atrasado (FLOOD_WAIT) que chega depois do job já
  // ter sido pausado/apagado vira no-op silencioso.
  if (job.status !== "exploring" && job.status !== "waiting_flood") {
    console.log(`[botclone] job ${cloneJobId} ignorado: status='${job.status}' (esperado exploring/waiting_flood)`);
    return;
  }

  // CAS lock — mesmo padrão de clone-handler.ts (defeito I6b lá, mesma
  // classe de bug aqui: dois workers processando o mesmo job em paralelo
  // duplicariam cliques reais no bot-alvo).
  const staleBefore = new Date(Date.now() - PROCESSING_CLAIM_STALE_MS).toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("bot_clone_jobs")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", cloneJobId)
    .in("status", ["exploring", "waiting_flood"])
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.error(`[botclone] falha ao reivindicar trava do job ${cloneJobId}: ${claimErr.message}`);
    return;
  }
  if (!claimed) {
    console.log(`[botclone] job ${cloneJobId} não reivindicado (trava de outro worker), ignorando`);
    return;
  }

  try {
    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("id, session_string, status")
      .eq("id", job.account_id)
      .single();
    if (!account?.session_string || account.status !== "active") {
      await fail(cloneJobId, "conta MTProto exploradora inativa ou sem sessão");
      return;
    }

    const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, account.session_string);
    const tmpDir = path.join(os.tmpdir(), "eaglebot-botclone", cloneJobId, "explore");

    try {
      await client.connect();

      let botPeerId = job.target_bot_peer_id as string | null;
      let botAccessHash = job.target_bot_access_hash as string | null;
      if (!botPeerId || !botAccessHash) {
        const resolved = await resolveTargetBot(client, job.target_bot_username);
        if (!resolved) {
          await fail(cloneJobId, `@${job.target_bot_username} não encontrado ou não é um bot`);
          return;
        }
        botPeerId = resolved.peerId;
        botAccessHash = resolved.accessHash;
        await supabase
          .from("bot_clone_jobs")
          .update({ target_bot_peer_id: botPeerId, target_bot_access_hash: botAccessHash })
          .eq("id", cloneJobId);
      }
      const botInputPeer = new Api.InputPeerUser({ userId: bigInt(botPeerId), accessHash: bigInt(botAccessHash) });

      await supabase
        .from("bot_clone_jobs")
        .update({ status: "exploring", explore_started_at: job.explore_started_at ?? new Date().toISOString() })
        .eq("id", cloneJobId);

      // Contadores em memória (mesmo padrão do heartbeat de clone-handler.ts:
      // escreve o total corrente, nunca lê-modifica-escreve — sob CAS lock
      // só um explorer roda por job, então não há corrida).
      const counters = {
        discovered: job.nodes_discovered ?? 0,
        skipped: job.nodes_skipped ?? 0,
        messages: job.messages_captured ?? 0,
      };

      const deps: BotExplorerDeps = {
        sendStart: () => client.sendMessage(job.target_bot_username, "username", "/start"),
        clickButton: async (msgId, data) => {
          await clickCallbackButton(client.raw, botInputPeer, msgId, data);
        },
        captureBurst: () => captureBurstFromBot(client.raw, botPeerId as string),
        rehostMedia: (media, nodeIdHint, fileName) =>
          downloadAndRehostMedia(
            { raw: client.raw, supabase },
            { media, tenantId: job.tenant_id, jobId: cloneJobId, nodeIdHint, fileName, tmpDir, maxBytes: MAX_FILE_BYTES },
          ),
        loadExistingNodes: () => loadExistingNodes(cloneJobId),
        persistNode: async (row: PersistNodeInput) => {
          const { data, error } = await supabase
            .from("bot_clone_nodes")
            .insert({
              job_id: cloneJobId,
              parent_node_id: row.parentNodeId,
              triggered_by_button_id: row.triggeredByButtonId,
              depth: row.depth,
              fingerprint: row.fingerprint,
              duplicate_of_node_id: row.duplicateOfNodeId,
              messages: row.messages.map(serializeMessage),
              status: row.status,
              payment_confirmation_suspected: row.paymentConfirmationSuspected,
            })
            .select("id")
            .single();
          if (error || !data) throw new Error(`persistNode falhou: ${error?.message}`);

          if (row.status === "explored") {
            counters.discovered++;
            counters.messages += row.messages.length;
            counters.skipped += row.messages.reduce((n, m) => n + m.buttons.filter((b) => b.skip).length, 0);
          }
          const patch: Record<string, unknown> = {
            nodes_discovered: counters.discovered,
            nodes_skipped: counters.skipped,
            messages_captured: counters.messages,
          };
          // Decisão do usuário: scanner pós-clique só sinaliza, não pausa a
          // exploração — o job continua normalmente até o fim natural (guard
          // pré-clique continua sendo a defesa primária).
          if (row.paymentConfirmationSuspected) patch.suspected_payment_hit = true;
          await supabase.from("bot_clone_jobs").update(patch).eq("id", cloneJobId);

          return data.id as string;
        },
        getStatus: async () => {
          const { data } = await supabase.from("bot_clone_jobs").select("status").eq("id", cloneJobId).maybeSingle();
          return data?.status ?? null;
        },
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
      };

      const explorer = new BotExplorer(deps, {
        maxDepth: job.max_depth,
        maxNodes: job.max_nodes,
        clickThrottleMs: job.click_throttle_ms,
      });
      await explorer.run();

      // Só transiciona pra listening_remarketing se o job ainda está
      // 'exploring' de verdade (não foi pausado/apagado por fora durante a
      // run — shouldStop() do explorer já teria parado o loop nesse caso).
      const { data: after } = await supabase.from("bot_clone_jobs").select("status").eq("id", cloneJobId).maybeSingle();
      if (after?.status === "exploring") {
        const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const nextPoll = new Date(Date.now() + REMARKETING_POLL_INTERVAL_MS);
        await supabase
          .from("bot_clone_jobs")
          .update({
            status: "listening_remarketing",
            explore_completed_at: new Date().toISOString(),
            remarketing_deadline: deadline.toISOString(),
            remarketing_next_poll_at: nextPoll.toISOString(),
          })
          .eq("id", cloneJobId);
        await enqueueMtproto({ kind: "botclone.remarketing-poll", cloneJobId }, { delayMs: REMARKETING_POLL_INTERVAL_MS });
      }
    } catch (err) {
      const wait = extractWaitSeconds(err);
      if (wait !== null) {
        console.warn(`[botclone] job ${cloneJobId} flood (${wait}s), agendando retomada`);
        await supabase
          .from("bot_clone_jobs")
          .update({ status: "waiting_flood", last_error: `flood_wait_${wait}s` })
          .eq("id", cloneJobId);
        await scheduleExploreResume(cloneJobId, wait);
      } else {
        console.error(`[botclone] job ${cloneJobId} falhou:`, err);
        await fail(cloneJobId, err instanceof Error ? err.message : String(err));
      }
    } finally {
      await client.disconnect().catch(() => {});
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await supabase.from("bot_clone_jobs").update({ processing_started_at: null }).eq("id", cloneJobId);
  }
}

// ---------------------------------------------------------------------------
// handleBotCloneRemarketingPoll
// ---------------------------------------------------------------------------

export async function handleBotCloneRemarketingPoll(cloneJobId: string): Promise<void> {
  const { data: job } = await supabase.from("bot_clone_jobs").select("*").eq("id", cloneJobId).single();
  if (!job || job.status !== "listening_remarketing") return;

  const staleBefore = new Date(Date.now() - PROCESSING_CLAIM_STALE_MS).toISOString();
  const { data: claimed } = await supabase
    .from("bot_clone_jobs")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", cloneJobId)
    .eq("status", "listening_remarketing")
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  try {
    if (job.remarketing_deadline && new Date(job.remarketing_deadline) <= new Date()) {
      await supabase.from("bot_clone_jobs").update({ status: "building_flow" }).eq("id", cloneJobId);
      await enqueueMtproto({ kind: "botclone.build-flow", cloneJobId });
      return;
    }

    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("session_string, status")
      .eq("id", job.account_id)
      .single();
    if (!account?.session_string || account.status !== "active") {
      // Remarketing é best-effort: conta caída no meio da janela não falha
      // o job, só perde essa rodada — tenta de novo no próximo tick.
      console.warn(`[botclone.remarketing] job ${cloneJobId}: conta exploradora inativa, tenta de novo no próximo tick`);
      await scheduleNextRemarketingPoll(cloneJobId);
      return;
    }

    const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, account.session_string);
    const tmpDir = path.join(os.tmpdir(), "eaglebot-botclone", cloneJobId, "remarketing");
    try {
      await client.connect();
      const botInputPeer = new Api.InputPeerUser({
        userId: bigInt(job.target_bot_peer_id),
        accessHash: bigInt(job.target_bot_access_hash),
      });

      const newMessages: Api.Message[] = [];
      for await (const raw of client.raw.iterMessages(botInputPeer, {
        minId: job.remarketing_cursor_msg_id,
        reverse: true,
      }) as AsyncIterable<unknown>) {
        if (!(raw instanceof Api.Message)) continue;
        // achado #14: só inbound — uma mensagem nossa nessa DM (retry manual,
        // teste) nunca deve virar "remarketing capturado".
        if (raw.out) continue;
        newMessages.push(raw);
      }

      if (newMessages.length > 0) {
        const newCursor = Math.max(...newMessages.map((m) => m.id));
        // Avança o cursor ANTES de inserir (achado #3/#7): falha nessa ordem
        // perde um burst raro em vez de duplicar uma mensagem real pra um
        // lead depois. A unique(job_id, first_seq_msg_id) é a 2ª camada.
        await supabase.from("bot_clone_jobs").update({ remarketing_cursor_msg_id: newCursor }).eq("id", cloneJobId);

        const secondsAfterExploreEnd = job.explore_completed_at
          ? Math.max(0, Math.floor((Date.now() - new Date(job.explore_completed_at).getTime()) / 1000))
          : 0;
        const messages = [];
        for (let i = 0; i < newMessages.length; i++) {
          const m = newMessages[i];
          const { mediaKind, media, fileName } = classifyRawMedia(m);
          let mediaPublicUrl: string | null = null;
          if (media && fileName) {
            mediaPublicUrl = await downloadAndRehostMedia(
              { raw: client.raw, supabase },
              {
                media,
                tenantId: job.tenant_id,
                jobId: cloneJobId,
                nodeIdHint: `remarketing_${m.id}`,
                fileName,
                tmpDir,
                maxBytes: MAX_FILE_BYTES,
              },
            ).catch((err) => {
              console.warn(`[botclone.remarketing] rehost falhou pra msg ${m.id} (segue sem mídia):`, err);
              return null;
            });
          }
          messages.push(
            serializeMessage({
              seq: i,
              rawMsgId: m.id,
              text: m.message || null,
              entities: gramjsEntitiesToCaptured(m.entities),
              mediaKind,
              mediaPublicUrl,
              // Remarketing é captura passiva — nenhum botão é clicado aqui;
              // preserva o rótulo original pra reconstrução (achado: sempre
              // vira nó unmapped, nunca some silenciosamente).
              buttons: extractRawButtons(m).map((raw, bi) => {
                const info = mapRawButton(raw);
                return {
                  id: `rb${i}_${bi}`,
                  kind: info.kind,
                  label: info.label,
                  url: info.url ?? null,
                  data: null,
                  skip: true,
                  skipReason: "remarketing_passive_capture",
                  paymentDomainMatch: false,
                };
              }),
            }),
          );
        }

        const { error: insertErr } = await supabase.from("bot_clone_remarketing_messages").insert({
          job_id: cloneJobId,
          first_seq_msg_id: newMessages[0].id,
          seconds_after_explore_end: secondsAfterExploreEnd,
          messages,
        });
        // unique(job_id, first_seq_msg_id) protege duplicata de verdade num
        // retry — conflito aqui é esperado, não um erro real.
        if (insertErr && !/duplicate key/i.test(insertErr.message)) {
          console.error(`[botclone.remarketing] insert falhou pro job ${cloneJobId}:`, insertErr.message);
        } else if (!insertErr) {
          await supabase
            .from("bot_clone_jobs")
            .update({ remarketing_messages_captured: (job.remarketing_messages_captured ?? 0) + newMessages.length })
            .eq("id", cloneJobId);
        }
      }
    } finally {
      await client.disconnect().catch(() => {});
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    await scheduleNextRemarketingPoll(cloneJobId);
  } catch (err) {
    console.error(`[botclone.remarketing] poll falhou pro job ${cloneJobId} (não fatal, tenta de novo no próximo tick):`, err);
    await scheduleNextRemarketingPoll(cloneJobId);
  } finally {
    await supabase.from("bot_clone_jobs").update({ processing_started_at: null }).eq("id", cloneJobId);
  }
}

async function scheduleNextRemarketingPoll(cloneJobId: string): Promise<void> {
  const next = new Date(Date.now() + REMARKETING_POLL_INTERVAL_MS);
  await supabase.from("bot_clone_jobs").update({ remarketing_next_poll_at: next.toISOString() }).eq("id", cloneJobId);
  await enqueueMtproto({ kind: "botclone.remarketing-poll", cloneJobId }, { delayMs: REMARKETING_POLL_INTERVAL_MS });
}

// ---------------------------------------------------------------------------
// tickBotCloneRemarketingWatchdog — chamado por um setInterval em queue.ts
// (nunca um BullMQ repeatable job — este codebase não usa essa feature em
// lugar nenhum; ver server/src/queue.ts's startWorkers para os 7+ precedentes).
// ---------------------------------------------------------------------------

export async function tickBotCloneRemarketingWatchdog(): Promise<void> {
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from("bot_clone_jobs")
    .select("id")
    .eq("status", "listening_remarketing")
    .lt("remarketing_next_poll_at", staleThreshold)
    .limit(50);
  if (!stuck || stuck.length === 0) return;
  for (const row of stuck) {
    console.warn(`[botclone.watchdog] job ${row.id} travado em listening_remarketing, reenfileirando`);
    await enqueueMtproto({ kind: "botclone.remarketing-poll", cloneJobId: row.id }).catch((err) =>
      console.error(`[botclone.watchdog] reenqueue falhou pro job ${row.id}:`, err),
    );
  }
}

// ---------------------------------------------------------------------------
// handleBotCloneBuildFlow — sem I/O de rede, só monta os grafos (pure) e
// grava. dest_flow_id/dest_remarketing_config_id sempre entram com
// is_active=false — nunca ativa um clone sozinho.
// ---------------------------------------------------------------------------

function computeRemarketingIntervalMinutes(rows: Array<{ seconds_after_explore_end: number }>): number {
  if (rows.length < 2) return 60;
  const sorted = [...rows].sort((a, b) => a.seconds_after_explore_end - b.seconds_after_explore_end);
  let minGapSec = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].seconds_after_explore_end - sorted[i - 1].seconds_after_explore_end;
    if (gap > 0 && gap < minGapSec) minGapSec = gap;
  }
  if (!Number.isFinite(minGapSec)) return 60;
  return Math.max(1, Math.round(minGapSec / 60));
}

export async function handleBotCloneBuildFlow(cloneJobId: string): Promise<void> {
  const { data: job } = await supabase.from("bot_clone_jobs").select("*").eq("id", cloneJobId).single();
  if (!job || job.status !== "building_flow") return;

  try {
    const { data: nodeRows } = await supabase.from("bot_clone_nodes").select("*").eq("job_id", cloneJobId);
    const capturedNodes: CapturedNodeForFlow[] = (nodeRows ?? []).map((row) => ({
      id: row.id,
      parentNodeId: row.parent_node_id,
      triggeredByButtonId: row.triggered_by_button_id,
      status: row.status as CapturedNodeForFlow["status"],
      duplicateOfNodeId: row.duplicate_of_node_id,
      messages: ((row.messages as Record<string, unknown>[] | null) ?? []).map(mapStoredMessage),
    }));
    const flowData = buildFlowGraph(capturedNodes);

    const { data: flowRow, error: flowErr } = await supabase
      .from("flows")
      .insert({
        tenant_id: job.tenant_id,
        bot_id: job.dest_bot_id,
        name: `Clone: @${job.target_bot_username}`,
        trigger_type: "command",
        trigger_value: "/start",
        flow_data: flowData,
        is_active: false,
        version: 1,
      })
      .select("id")
      .single();
    if (flowErr || !flowRow) throw new Error(`insert flows falhou: ${flowErr?.message}`);

    const { data: rmRows } = await supabase
      .from("bot_clone_remarketing_messages")
      .select("*")
      .eq("job_id", cloneJobId)
      .order("seconds_after_explore_end", { ascending: true });

    let remarketingConfigId: string | null = null;
    if (rmRows && rmRows.length > 0) {
      const { data: cfgRow, error: cfgErr } = await supabase
        .from("remarketing_configs")
        .insert({
          tenant_id: job.tenant_id,
          bot_id: job.dest_bot_id,
          is_active: false,
          interval_minutes: computeRemarketingIntervalMinutes(rmRows),
        })
        .select("id")
        .single();
      if (cfgErr || !cfgRow) throw new Error(`insert remarketing_configs falhou: ${cfgErr?.message}`);
      remarketingConfigId = cfgRow.id as string;

      for (let i = 0; i < rmRows.length; i++) {
        const r = rmRows[i];
        const syntheticNode: CapturedNodeForFlow = {
          id: `rm_${r.id}`,
          parentNodeId: null,
          triggeredByButtonId: null,
          status: "explored",
          duplicateOfNodeId: null,
          messages: ((r.messages as Record<string, unknown>[] | null) ?? []).map(mapStoredMessage),
        };
        const rmFlowData = buildFlowGraph([syntheticNode]);
        const { error: rmFlowErr } = await supabase.from("remarketing_flows").insert({
          config_id: remarketingConfigId,
          bot_id: job.dest_bot_id,
          name: `Remarketing clonado #${i + 1}`,
          sort_order: i,
          audience: "all",
          flow_data: rmFlowData,
          is_active: false,
        });
        if (rmFlowErr) {
          console.error(`[botclone.build-flow] insert remarketing_flows #${i} falhou pro job ${cloneJobId}:`, rmFlowErr.message);
        }
      }
    }

    await supabase
      .from("bot_clone_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        dest_flow_id: flowRow.id,
        dest_remarketing_config_id: remarketingConfigId,
      })
      .eq("id", cloneJobId);
  } catch (err) {
    console.error(`[botclone.build-flow] job ${cloneJobId} falhou:`, err);
    await fail(cloneJobId, err instanceof Error ? err.message : String(err));
  }
}
