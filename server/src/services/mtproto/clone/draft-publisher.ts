import type { Api } from "telegram";
import { planForMessage } from "./media-plan.js";
import type { CloneMediaKind, PlanInput } from "./media-plan.js";
import type { CloneOutcome, SourceMessage } from "./types.js";
import type { InlineLink, SourcePoll } from "./bot-client.js";

/** Item de mídia no shape que a UI já lê (MediaItem de lib/social-proof/types). */
export interface StagedMedia {
  url: string;
  type: "photo" | "video" | "audio";
}

/** Uma linha de mtproto_scheduled_messages, antes de virar SQL. */
export interface StagedRow {
  sourceMsgId: number;
  kind: "text" | "photo" | "video" | "audio" | "album" | "document" | "poll";
  contentText: string | null;
  media: StagedMedia[];
  entities: unknown[] | null;
  inlineLinks: InlineLink[] | null;
  poll: SourcePoll | null;
  fileName: string | null;
  /** Sempre 0 aqui: a renumeração determinística acontece no fim do job. */
  position: number;
  /** Id NA ORIGEM da mensagem respondida. Vira uuid no caller. */
  replyToSourceMsgId: number | null;
}

export interface DraftPublisherDeps {
  /**
   * Baixa a mídia da mensagem e devolve a URL pública, ou null se ela passar
   * do teto de tamanho.
   *
   * `hint` identifica a mensagem na chave do Storage; `fileName` carrega a
   * EXTENSÃO. Os dois são separados porque guessContentType (media-rehost.ts)
   * deduz o content-type pela extensão: sem ela tudo vira
   * application/octet-stream, e o <video> da prévia recusa tocar.
   */
  rehost(raw: Api.Message, hint: string, fileName: string): Promise<string | null>;
  /** Upsert por (campaign_id, source_msg_id). Nunca recebe lista vazia. */
  upsert(rows: StagedRow[]): Promise<void>;
  /**
   * As quatro leituras da mensagem entram injetadas, e não importadas de
   * SourceReader, porque todas usam `instanceof Api.X` — com import direto,
   * testar este arquivo exigiria construir Api.Message de verdade do gramjs.
   * O caller (clone-handler) passa os estáticos do SourceReader.
   */
  planInput(raw: Api.Message, copyPolls: boolean): PlanInput;
  extractInlineLinks(raw: Api.Message): InlineLink[] | undefined;
  pollData(raw: Api.Message): SourcePoll | null;
  originalFileName(raw: Api.Message): string | null;
  copyPolls: boolean;
  copyButtons: boolean;
  /**
   * Troca de @mentions/links por categoria, quando o job configurou. null =
   * grava o texto como veio.
   */
  rewrite:
    | ((input: {
        message: string | undefined;
        entities: Api.TypeMessageEntity[] | undefined;
        inlineLinks: InlineLink[] | undefined;
      }) => Promise<{
        text: string;
        entities: Api.TypeMessageEntity[] | undefined;
        inlineLinks: InlineLink[] | undefined;
      }>)
    | null;
}

/** Só foto e vídeo entram num álbum do Telegram — mesma regra do publish-router. */
const ALBUMABLE = new Set<CloneMediaKind>(["photo", "video"]);

/**
 * Extensão de fallback por tipo de mídia. Só entra quando a origem não trouxe
 * DocumentAttributeFilename (foto e vídeo nunca trazem). É ela que faz o
 * Storage servir o content-type certo pra prévia.
 */
const EXT: Record<CloneMediaKind, string> = {
  photo: "jpg",
  video: "mp4",
  animation: "mp4",
  audio: "mp3",
  sticker: "webp",
  document: "bin",
};

/** CloneMediaKind -> o `type` que a UI entende. Áudio é o único caso separado. */
function toStagedMediaType(kind: CloneMediaKind): StagedMedia["type"] {
  if (kind === "video" || kind === "animation") return "video";
  if (kind === "audio") return "audio";
  return "photo";
}

/** CloneMediaKind -> o `kind` da linha, que também é o que o worker despacha. */
function toRowKind(kind: CloneMediaKind): StagedRow["kind"] {
  if (kind === "photo") return "photo";
  if (kind === "video" || kind === "animation") return "video";
  if (kind === "audio") return "audio";
  return "document";
}

/**
 * Devolve a função `publish` que o CloneRunner injeta no modo rascunho.
 *
 * Contrato herdado do runner e que NÃO pode ser quebrado: um CloneOutcome por
 * mensagem do grupo, na mesma ordem. O destMsgId devolvido é o próprio
 * source id — assim o idMap do runner vira a identidade e a retomada pelo
 * cursor continua funcionando sem numeração inventada.
 */
export function createDraftPublisher(
  deps: DraftPublisherDeps,
): (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]> {
  return async (group, replyToDestId) => {
    const raws = group.map((g) => g.raw as Api.Message);
    const plans = raws.map((raw) => planForMessage(deps.planInput(raw, deps.copyPolls)));

    // Um grupo é sempre de um tipo só na prática (álbum é foto/vídeo), mas o
    // primeiro item é quem define kind, texto e reply da linha resultante.
    const first = plans[0];

    if (first.kind === "skip") {
      return plans.map((p) => ({
        status: "skipped" as const,
        reason: p.kind === "skip" ? p.reason : "skip",
      }));
    }

    // ── Texto, entities e botões, já com a troca de link aplicada.
    const inlineLinks = deps.copyButtons ? deps.extractInlineLinks(raws[0]) : undefined;
    let text = raws[0].message ?? "";
    let entities = raws[0].entities;
    let links = inlineLinks;
    if (deps.rewrite && first.kind !== "poll") {
      const r = await deps.rewrite({
        message: raws[0].message,
        entities: raws[0].entities,
        inlineLinks,
      });
      text = r.text;
      entities = r.entities;
      links = r.inlineLinks;
    }

    const base = {
      sourceMsgId: group[0].id,
      contentText: text === "" ? null : text,
      entities: entities ? (entities as unknown[]) : null,
      inlineLinks: links && links.length > 0 ? links : null,
      position: 0,
      replyToSourceMsgId: replyToDestId,
    };

    // ── Enquete
    if (first.kind === "poll") {
      const poll = deps.pollData(raws[0]);
      if (!poll) {
        return plans.map(() => ({ status: "skipped" as const, reason: "poll_sem_dados" }));
      }
      await deps.upsert([
        { ...base, kind: "poll", media: [], poll, fileName: null },
      ]);
      return group.map((g) => ({ status: "copied" as const, destMsgId: g.id }));
    }

    // ── Texto puro
    if (first.kind === "text") {
      await deps.upsert([
        { ...base, kind: "text", media: [], poll: null, fileName: null },
      ]);
      return group.map((g) => ({ status: "copied" as const, destMsgId: g.id }));
    }

    // ── Mídia: rehospeda cada item que couber no teto, guardando o outcome
    // por índice. Um item que cai (tamanho, ou plano skip) não pode virar
    // "copied": isso infla o contador do runner e some com o conteúdo sem
    // deixar rastro no relatório de skip (achado de revisão — publish-router
    // já resolve o mesmo caso na rota download).
    const media: StagedMedia[] = [];
    const outcomes: CloneOutcome[] = new Array(raws.length);
    let firstSurvivingIndex: number | null = null;

    for (let i = 0; i < raws.length; i++) {
      const plan = plans[i];

      if (plan.kind === "skip") {
        // Álbum pode ter um item de mídia não suportada no meio dos outros.
        outcomes[i] = { status: "skipped", reason: plan.reason };
        continue;
      }

      if (plan.kind !== "media") {
        // Não deveria acontecer num grupo de mídia na prática, mas um item
        // texto/poll misturado não pode sair como copied.
        outcomes[i] = { status: "skipped", reason: "sem_midia_no_album" };
        continue;
      }

      const nomeArquivo = deps.originalFileName(raws[i]) ?? `arquivo.${EXT[plan.mediaKind]}`;
      const url = await deps.rehost(raws[i], `msg_${group[i].id}`, nomeArquivo);
      if (url === null) {
        // Grande demais: some do álbum, não derruba os irmãos.
        outcomes[i] = { status: "skipped", reason: "file_too_large" };
        continue;
      }

      if (firstSurvivingIndex === null) firstSurvivingIndex = i;
      media.push({ url, type: toStagedMediaType(plan.mediaKind) });
      outcomes[i] = { status: "copied", destMsgId: group[i].id };
    }

    if (media.length === 0) {
      return plans.map(() => ({ status: "skipped" as const, reason: "file_too_large" }));
    }

    // Álbum de verdade só quando sobrou mais de um item albumável. Um item
    // sozinho é envio simples, e preservar o mediaKind real importa pro worker.
    const ehAlbum =
      media.length > 1 &&
      plans.every((p) => p.kind === "media" && ALBUMABLE.has(p.mediaKind));

    // A linha é ancorada no primeiro item que SOBREVIVEU, não em group[0]:
    // se o item 0 caiu por tamanho mas os irmãos sobreviveram, ancorar em
    // group[0].id apontaria o índice único (campaign_id, source_msg_id) pra
    // uma mensagem que o relatório de skip diz nunca ter sido copiada — e uma
    // resposta mirando um dos sobreviventes não encontraria a linha. Sempre
    // definido aqui: media.length === 0 já retornou acima.
    const anchor = firstSurvivingIndex ?? 0;

    await deps.upsert([
      {
        ...base,
        sourceMsgId: group[anchor].id,
        kind: ehAlbum ? "album" : toRowKind(first.mediaKind),
        media,
        poll: null,
        // Nome do arquivo também migra pro sobrevivente-âncora: o de raws[0]
        // pode ser exatamente o item que caiu. A legenda (em `base`) continua
        // vindo de raws[0] sempre — o Telegram ancora ela no primeiro item do
        // álbum, sobreviva ele ou não, e perder texto que o usuário escreveu
        // só porque a foto era grande demais seria pior que perder a foto.
        fileName: deps.originalFileName(raws[anchor]),
      },
    ]);

    return outcomes;
  };
}
