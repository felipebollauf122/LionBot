import { Api } from "telegram";
import { rm } from "node:fs/promises";
import { planForMessage } from "./media-plan.js";
import type { MediaPlan } from "./media-plan.js";
import { SourceReader } from "./source-reader.js";
import type { CompanionBot } from "./bot-client.js";
import { rewriteMessageLinks } from "./link-replace.js";
import type { LinkReplaceDeps, LinkReplaceValues } from "./link-replace.js";
import type { CloneOutcome, CloneStrategy, SourceMessage } from "./types.js";

/** Só foto e vídeo entram num álbum do Telegram. */
const ALBUMABLE = new Set(["photo", "video"]);

export function chooseStrategy(input: {
  requested: "auto" | "batch" | "download";
  sourceHasNoForwards: boolean;
  copyButtons: boolean;
  /**
   * Defeito I5: opcional com default false pra não quebrar o build enquanto
   * o call site em clone-handler.ts ainda não passa esse campo (ver nota no
   * relatório da task — o outro agente precisa somar `copyReplies:
   * job.copy_replies` na chamada de lá).
   */
  copyReplies?: boolean;
  /**
   * Clone cross-account: a conta que lê a origem é diferente da que cria o
   * destino. O ForwardMessages encaminha de um chat pro outro DENTRO da mesma
   * sessão — com contas diferentes ninguém está nos dois lados, então a rota
   * lote é impossível. Opcional com default false (mesma conta = comportamento
   * atual).
   */
  crossAccount?: boolean;
  /**
   * Troca de link (bot/grupo/canal) configurada. O ForwardMessages copia o
   * conteúdo server-side — o app nunca vê raw.message/raw.entities/botões
   * nessa rota, então trocar link ali dentro é impossível. Mesma razão de
   * copyButtons acima.
   */
  linkReplaceConfigured?: boolean;
}): CloneStrategy {
  // Contas diferentes na origem e no destino: forward entre sessões não existe.
  if (input.crossAccount) return "download";
  // Encaminhamento não permite anexar reply_markup: quem quer botão, baixa.
  if (input.copyButtons) return "download";
  // ForwardMessages só aceita ids, sem como ancorar um reply_to no destino:
  // quem liga "respostas encadeadas" (copyReplies) também precisa baixar,
  // senão o replyToDestId calculado pelo runner é descartado em silêncio.
  if (input.copyReplies) return "download";
  if (input.linkReplaceConfigured) return "download";
  if (input.sourceHasNoForwards) return "download";
  return input.requested === "download" ? "download" : "batch";
}

export type RouteDecision =
  | { mode: "forward"; skipIndexes?: number[] }
  | { mode: "album" }
  | { mode: "single" }
  | { mode: "skip_all" };

export interface RouteInput {
  strategy: CloneStrategy;
  plans: MediaPlan[];
  copyPolls: boolean;
  copyButtons: boolean;
}

export function routeGroup(input: RouteInput): RouteDecision {
  // copyPolls/copyButtons não são lidos aqui: chooseStrategy já resolveu os
  // dois em `strategy` (poll é decidido em planForMessage, botão vira
  // "download" na estratégia) — reagir de novo aqui duplicaria a decisão.
  const { strategy, plans } = input;
  const skipIndexes = plans
    .map((p, i) => (p.kind === "skip" ? i : -1))
    .filter((i) => i >= 0);

  if (skipIndexes.length === plans.length) return { mode: "skip_all" };

  if (strategy === "batch") {
    return skipIndexes.length > 0 ? { mode: "forward", skipIndexes } : { mode: "forward" };
  }

  const albumable =
    plans.length > 1 &&
    plans.every((p) => p.kind === "media" && ALBUMABLE.has(p.mediaKind));
  return albumable ? { mode: "album" } : { mode: "single" };
}

/** Teto por arquivo. Acima disso a mensagem é pulada com reason file_too_large. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface PublisherContext {
  reader: SourceReader;
  bot: CompanionBot;
  destChannelId: string;
  destAccessHash: string;
  strategy: CloneStrategy;
  copyPolls: boolean;
  copyButtons: boolean;
  tmpDir: string;
  /** Mapa origem->destino de tópicos de fórum. null = job sem fórum (comportamento de sempre). */
  topicMap: Map<number, number> | null;
  /** Troca de link por categoria. null = job sem a feature (comportamento de sempre). */
  linkReplace: { classify: LinkReplaceDeps["classify"]; values: LinkReplaceValues } | null;
}

/**
 * Resolve o tópico de destino de um grupo já fatiado (flush do CloneRunner).
 * Um grupo é sempre de um único tópico por construção: mensagem solta flusha
 * sozinha, e álbum (mesmo groupedId) é sempre uma ação atômica de um cliente
 * num único chat — o Telegram não deixa um álbum atravessar tópicos. Por
 * isso só o primeiro item do grupo é consultado.
 */
function resolveDestTopicId(
  topicMap: Map<number, number> | null,
  group: SourceMessage[],
): number | undefined {
  if (!topicMap) return undefined; // job sem fórum: nunca toca message_thread_id/topMsgId
  const sourceTopicId = group[0].topicId;
  if (sourceTopicId === null) return undefined; // General, ou mensagem fora de tópico
  return topicMap.get(sourceTopicId) ?? 1; // tópico mapeado, ou General se aquele tópico falhou ao criar
}

/**
 * Devolve a função `publish` que o CloneRunner injeta. Toda a decisão já foi
 * tomada por chooseStrategy/routeGroup; aqui é só execução.
 */
export function createPublisher(
  ctx: PublisherContext,
): (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]> {
  return async (group, replyToDestId) => {
    const destTopicId = resolveDestTopicId(ctx.topicMap, group);
    const raws = group.map((m) => m.raw as Api.Message);
    const plans = raws.map((r) =>
      planForMessage(SourceReader.mediaPlanInput(r, ctx.copyPolls)),
    );
    const decision = routeGroup({
      strategy: ctx.strategy,
      plans,
      copyPolls: ctx.copyPolls,
      copyButtons: ctx.copyButtons,
    });

    if (decision.mode === "skip_all") {
      return plans.map((p) => ({
        status: "skipped" as const,
        reason: p.kind === "skip" ? p.reason : "skip",
      }));
    }

    if (decision.mode === "forward") {
      const skip = new Set(decision.skipIndexes ?? []);
      const ids = raws.filter((_, i) => !skip.has(i)).map((r) => r.id);
      // ForwardMessages exige ids em ordem crescente.
      const updates = await ctx.reader.forwardBatch(
        ctx.destChannelId,
        ctx.destAccessHash,
        [...ids].sort((a, b) => a - b),
        destTopicId,
      );
      const destIds = extractNewMessageIds(updates);
      let cursor = 0;
      return plans.map((p, i) => {
        if (skip.has(i)) {
          return { status: "skipped" as const, reason: p.kind === "skip" ? p.reason : "skip" };
        }
        const destMsgId = destIds[cursor++];
        return destMsgId
          ? { status: "copied" as const, destMsgId }
          : { status: "failed" as const, reason: "sem_id_no_retorno" };
      });
    }

    // Rotas de download: a conta baixa, o bot publica.
    const outcomes: CloneOutcome[] = [];
    const downloaded: string[] = [];
    try {
      if (decision.mode === "album") {
        // Baixa tudo primeiro: um item grande demais não pode derrubar os
        // irmãos que couberam no teto (ver finding do review de Task 10).
        const ok: Array<{
          index: number;
          filePath: string;
          kind: "photo" | "video";
          caption: string;
          entities: Api.TypeMessageEntity[] | undefined;
        }> = [];
        const tooLarge = new Set<number>();
        for (let i = 0; i < raws.length; i++) {
          const dl = await ctx.reader.downloadToPath(raws[i], ctx.tmpDir, MAX_FILE_BYTES);
          if (!dl) {
            tooLarge.add(i);
            continue;
          }
          downloaded.push(dl.filePath);
          const plan = plans[i];
          let caption = raws[i].message ?? "";
          let entities = raws[i].entities;
          // Álbum nunca tem botão (sendMediaGroup não suporta reply_markup) —
          // inlineLinks sempre undefined aqui.
          if (ctx.linkReplace) {
            const rewritten = await rewriteMessageLinks(
              { message: raws[i].message, entities: raws[i].entities, inlineLinks: undefined },
              { classify: ctx.linkReplace.classify },
              ctx.linkReplace.values,
            );
            caption = rewritten.text;
            entities = rewritten.entities;
          }
          ok.push({
            index: i,
            filePath: dl.filePath,
            kind: plan.kind === "media" && plan.mediaKind === "video" ? "video" : "photo",
            caption,
            entities,
          });
        }

        // Nenhum item coube: nada pra enviar, nenhuma chamada ao Telegram.
        if (ok.length === 0) {
          return plans.map(() => ({ status: "skipped" as const, reason: "file_too_large" }));
        }

        // Alguns (mas não todos) grandes demais: um álbum parcial não
        // preserva o 1:1 com os ids de volta, e "álbum" de 1 item não é
        // álbum de verdade — degrada pra envios individuais via publishMedia,
        // preservando o mediaKind real (foto ou vídeo) de cada item.
        if (tooLarge.size > 0) {
          const degraded: CloneOutcome[] = new Array(raws.length);
          let replyUsed = false;
          for (const item of ok) {
            const destMsgId = await ctx.bot.publishMedia(item.filePath, item.kind, item.caption, {
              replyToMessageId: !replyUsed && replyToDestId != null ? replyToDestId : undefined,
              entities: item.entities,
              messageThreadId: destTopicId,
            });
            degraded[item.index] = { status: "copied", destMsgId };
            replyUsed = true;
          }
          for (const i of tooLarge) {
            degraded[i] = { status: "skipped", reason: "file_too_large" };
          }
          return degraded;
        }

        // Todos ok: álbum de verdade. O reply do grupo vai no álbum inteiro —
        // o Telegram ancora automaticamente no primeiro item do media group.
        const items = ok.map(({ filePath, kind, caption, entities }) => ({
          filePath,
          kind,
          caption,
          entities,
        }));
        const destIds = await ctx.bot.publishAlbum(items, {
          replyToMessageId: replyToDestId != null ? replyToDestId : undefined,
          messageThreadId: destTopicId,
        });
        // Guarda de alinhamento: sem isso, um retorno mais curto (ou fora de
        // ordem) do publishAlbum atribuiria o destMsgId errado a uma
        // mensagem de origem errada. Mapeia o que dá pra mapear
        // posicionalmente; o resto vira failed, igual ao sem_id_no_retorno
        // do forward.
        if (destIds.length !== items.length) {
          return items.map((_, i) =>
            i < destIds.length
              ? { status: "copied" as const, destMsgId: destIds[i] }
              : { status: "failed" as const, reason: "album_id_count_mismatch" },
          );
        }
        return destIds.map((destMsgId) => ({ status: "copied" as const, destMsgId }));
      }

      for (let i = 0; i < raws.length; i++) {
        const raw = raws[i];
        const plan = plans[i];
        const opts = {
          replyToMessageId: i === 0 && replyToDestId ? replyToDestId : undefined,
          entities: raw.entities,
          inlineLinks: ctx.copyButtons ? SourceReader.extractInlineLinks(raw) : undefined,
          messageThreadId: destTopicId,
        };

        if (plan.kind === "skip") {
          outcomes.push({ status: "skipped", reason: plan.reason });
          continue;
        }

        // Troca de link: só compensa reescrever quando a mensagem de fato
        // publica texto/entities (enquete não usa nenhum dos dois, e
        // "skip" já saiu acima) — evita RPC de resolução à toa.
        let text = raw.message ?? "";
        let publishEntities = opts.entities;
        let publishInlineLinks = opts.inlineLinks;
        if (ctx.linkReplace && plan.kind !== "poll") {
          const rewritten = await rewriteMessageLinks(
            { message: raw.message, entities: raw.entities, inlineLinks: opts.inlineLinks },
            { classify: ctx.linkReplace.classify },
            ctx.linkReplace.values,
          );
          text = rewritten.text;
          publishEntities = rewritten.entities;
          publishInlineLinks = rewritten.inlineLinks;
        }

        if (plan.kind === "text") {
          const destMsgId = await ctx.bot.publishText(text, {
            ...opts,
            entities: publishEntities,
            inlineLinks: publishInlineLinks,
          });
          outcomes.push({ status: "copied", destMsgId });
          continue;
        }
        if (plan.kind === "poll") {
          // Defeito I7: com copyPolls ligado, planForMessage já marcou a
          // mensagem como "poll" — recria via Bot API em vez de pular. Sem
          // arquivo pra baixar aqui: enquete não passa por downloadToPath.
          const pollData = SourceReader.pollData(raw);
          if (!pollData) {
            outcomes.push({ status: "skipped", reason: "poll_sem_suporte_no_bot" });
            continue;
          }
          try {
            const destMsgId = await ctx.bot.publishPoll(pollData, {
              replyToMessageId: opts.replyToMessageId,
              messageThreadId: opts.messageThreadId,
            });
            outcomes.push({ status: "copied", destMsgId });
          } catch {
            outcomes.push({ status: "skipped", reason: "poll_sem_suporte_no_bot" });
          }
          continue;
        }
        const dl = await ctx.reader.downloadToPath(raw, ctx.tmpDir, MAX_FILE_BYTES);
        if (!dl) {
          outcomes.push({ status: "skipped", reason: "file_too_large" });
          continue;
        }
        downloaded.push(dl.filePath);
        const destMsgId = await ctx.bot.publishMedia(dl.filePath, plan.mediaKind, text, {
          ...opts,
          entities: publishEntities,
          inlineLinks: publishInlineLinks,
          fileName: dl.fileName ?? undefined,
        });
        outcomes.push({ status: "copied", destMsgId });
      }
      return outcomes;
    } finally {
      // Limpeza por grupo: um clone de canal grande encheria o disco.
      for (const f of downloaded) await rm(f, { force: true }).catch(() => {});
    }
  };
}

/** Colhe os ids criados no destino a partir do Updates do ForwardMessages. */
export function extractNewMessageIds(updates: Api.TypeUpdates): number[] {
  const list =
    updates instanceof Api.Updates || updates instanceof Api.UpdatesCombined
      ? updates.updates
      : [];
  const ids: number[] = [];
  for (const u of list) {
    if (u instanceof Api.UpdateNewChannelMessage || u instanceof Api.UpdateNewMessage) {
      const msg = u.message;
      if (msg instanceof Api.Message) ids.push(msg.id);
    }
  }
  return ids.sort((a, b) => a - b);
}
