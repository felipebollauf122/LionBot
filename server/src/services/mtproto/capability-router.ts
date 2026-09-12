import { Api } from "telegram";
import bigInt from "big-integer";
import {
  CapabilityResolver, peerKey,
  type ContentKind, type DestinationMetadata, type DestinationPeer,
} from "./capability-resolver.js";
import {
  CapabilityUnavailable, describeFailure, isCapabilityError, permissionRefusal, rpcCode,
} from "./capability-errors.js";

export type Capability = "DIRECT_POST" | "COMMENT_ONLY" | "FORWARD_ONLY" | "READ_ONLY";
export type WriteRoute = Exclude<Capability, "READ_ONLY">;

export interface RouteRequest {
  target: DestinationPeer;
  /** Inteiro signed int64 em decimal. Persistir e reutilizar no retry do MESMO envio. */
  randomId: string;
  operation:
    | { kind: "text"; text: string; allowComments?: boolean; commentOnPostId?: number; topicId?: number }
    | { kind: "forward"; source: DestinationPeer; messageId: number; topicId?: number };
}

export interface CapabilityProfile {
  capability: Capability;
  destination: DestinationMetadata;
  actualDestination?: DestinationMetadata;
  replyToMsgId?: number;
  expiresAt: number;
  reason?: string;
}

interface ResultBase { accountId: string; targetKey: string; randomId: string }
export type RouteResult = ResultBase & (
  | { status: "SENT"; sent: true; route: WriteRoute; actualTargetKey: string }
  | { status: "SKIPPED_CAPABILITY"; sent: false; reason: string; recheckAt?: number }
  | { status: "RETRY_NEXT_ROUTE"; sent: false; previousRoute: Capability; nextRoute: WriteRoute;
      nextTargetKey: string; reason: string; retryAt: number }
  | { status: "FAIL"; sent: false; code: string; retryable: boolean; retryAfterMs?: number;
      deliveryUnknown: boolean; previousCode?: string }
);

/** Destino/grupo de discussão exige seus próprios direitos de escrita. */
export function writingProblem(meta: DestinationMetadata, content: ContentKind, discussion = false): string | undefined {
  if (meta.observedRefusal) return meta.observedRefusal.code;
  if (meta.blockedReason) return meta.blockedReason;
  if (!meta.isMember && !(discussion && meta.kind === "megagroup" && !meta.joinToSend)) {
    return meta.joinToSend ? "CHAT_GUEST_SEND_FORBIDDEN" : "NOT_A_MEMBER";
  }
  if (!meta.allowed[content]) return `CONTENT_NOT_ALLOWED_${content.toUpperCase()}`;
  return undefined;
}

/**
 * Escrito para GramJS 2.26.22; não inicia conexão, não entra em grupos nem
 * altera direitos. Construir com o TelegramClient autenticado da conta.
 * Para devolver limites ao agendador sem dormir dentro do GramJS, configurar
 * o client com floodSleepThreshold: 0. O router não muda o client compartilhado.
 *
 * Uso (no chamador): resolver.resolvePeer(entity) -> router.dispatch(request).
 * SENT incrementa enviadas; SKIPPED_CAPABILITY vai para pulados; RETRY_NEXT_ROUTE
 * mantém pending e agenda retryAt. FAIL preserva retryAfterMs/deliveryUnknown.
 * Reavaliar pulados após recheckAt, porque as permissões podem mudar.
 * Esta implementação não é importada pelo worker existente automaticamente.
 */
export class CapabilityRouter {
  constructor(
    readonly resolver: CapabilityResolver,
    private readonly log?: (result: RouteResult) => void | Promise<void>,
  ) {}

  async classify(request: RouteRequest): Promise<CapabilityProfile> {
    const destination = await this.resolver.get(request.target);
    if (request.operation.kind === "forward") {
      // VERIFY: não existe direito MTProto "forward-only". É uma rota da
      // aplicação, dependente da origem e do conteúdo. Encaminhar também exige
      // escrita no destino; não é fallback para um sendMessage proibido.
      // https://core.telegram.org/method/messages.forwardMessages
      const content = await this.forwardContent(request.operation);
      const reason = writingProblem(destination, content);
      return reason ? this.readOnly(destination, reason) : {
        capability: "FORWARD_ONLY", destination, actualDestination: destination,
        expiresAt: destination.expiresAt,
      };
    }

    const reason = writingProblem(destination, "text");
    if (!reason) return {
      capability: "DIRECT_POST", destination, actualDestination: destination,
      expiresAt: destination.expiresAt,
    };
    if (destination.kind !== "channel" || !destination.canRead || !destination.linkedChatId ||
        request.operation.allowComments === false) return this.readOnly(destination, reason);

    return this.commentProfile(destination, request.operation.commentOnPostId);
  }

  async dispatch(request: RouteRequest): Promise<RouteResult> {
    let profile: CapabilityProfile | undefined;
    let sending = false;
    let result: RouteResult;
    try {
      const randomId = this.checkedRandomId(request.randomId);
      if (request.operation.kind === "text" && !request.operation.text.trim()) throw new Error("EMPTY_MESSAGE");
      if (request.operation.topicId !== undefined) this.checkMessageId(request.operation.topicId);
      profile = await this.classify(request);
      // Consultar origem/discussão pode demorar. Conferir o TTL novamente junto
      // ao envio; se nem a segunda leitura fica fresca, devolver ao agendador.
      if (profile.expiresAt <= this.resolver.timestamp()) profile = await this.classify(request);
      if (profile.expiresAt <= this.resolver.timestamp()) throw new Error("CAPABILITY_RESOLUTION_TIMEOUT");
      if (profile.capability === "READ_ONLY" || !profile.actualDestination) {
        result = this.skipped(request, profile.reason ?? "NO_SUPPORTED_ROUTE", profile.expiresAt);
      } else {
        const actual = profile.actualDestination;
        const operation = request.operation;
        if (operation.topicId !== undefined && (profile.capability === "COMMENT_ONLY" || !actual.isForum)) {
          throw new CapabilityUnavailable("TOPIC_NOT_APPLICABLE_TO_ROUTE");
        }
        if (operation.kind === "forward") {
          sending = true;
          await this.resolver.client.invoke(new Api.messages.ForwardMessages({
            fromPeer: operation.source, id: [operation.messageId], randomId: [randomId],
            toPeer: actual.peer, topMsgId: operation.topicId,
          }));
        } else {
          const replyId = profile.replyToMsgId ?? operation.topicId;
          sending = true;
          await this.resolver.client.invoke(new Api.messages.SendMessage({
            peer: actual.peer,
            message: operation.text,
            randomId,
            noWebpage: true,
            replyTo: replyId === undefined ? undefined : new Api.InputReplyToMessage({
              replyToMsgId: replyId,
              // topMsgId é relevante para tópico de fórum. Para comentário,
              // replyToMsgId já aponta para a raiz no grupo de discussão.
              topMsgId: profile.capability === "DIRECT_POST" ? operation.topicId : undefined,
            }),
          }));
        }
        result = { ...this.base(request), status: "SENT", sent: true,
          route: profile.capability, actualTargetKey: actual.key };
      }
    } catch (error) {
      result = sending && profile && permissionRefusal(error)
        ? await this.handleSendError(error, request, profile)
        : this.failureOrSkip(error, request, sending);
    }
    // Falha no logger após confirmação NÃO pode transformar SENT em FAIL
    // e provocar duplicação. O chamador recebe o resultado mesmo assim.
    try { await this.log?.(result); } catch { /* logging é observacional */ }
    return result;
  }

  /** Reclassifica apenas com leituras. Nenhum segundo envio nesta chamada. */
  async handleSendError(error: unknown, request: RouteRequest, previous: CapabilityProfile): Promise<RouteResult> {
    const code = permissionRefusal(error);
    if (!code || !previous.actualDestination) return this.failureOrSkip(error, request, true);
    this.resolver.invalidate(request.target);
    this.resolver.recordRefusal(previous.actualDestination.peer, code);
    try {
      const next = await this.classify(request);
      if (next.capability === "READ_ONLY" || !next.actualDestination) {
        return this.skipped(request, next.reason ?? code, next.expiresAt);
      }
      // VERIFY: o pedido descreve RETRY_NEXT_ROUTE como "reenviou", mas também
      // exige não retentar no mesmo turno. Aqui significa retry AGENDÁVEL;
      // sent=false. Só outra chamada a dispatch poderá produzir SENT.
      return { ...this.base(request), status: "RETRY_NEXT_ROUTE", sent: false,
        previousRoute: previous.capability, nextRoute: next.capability,
        nextTargetKey: next.actualDestination.key, reason: code,
        retryAt: this.resolver.timestamp() + 1_000 };
    } catch (reclassificationError) {
      const result = this.failureOrSkip(reclassificationError, request, false);
      return result.status === "FAIL" ? { ...result, previousCode: code } : result;
    }
  }

  private async commentProfile(primary: DestinationMetadata, explicitPostId?: number): Promise<CapabilityProfile> {
    if (!(primary.peer instanceof Api.InputPeerChannel)) return this.readOnly(primary, "NOT_A_CHANNEL");
    const post = explicitPostId === undefined
      ? await this.latestPost(primary.peer)
      : await this.message(primary.peer, explicitPostId);
    if (!post || !post.post || !post.replies?.comments) return this.readOnly(primary, "POST_HAS_NO_COMMENTS");
    if (post.replies.channelId?.toString() !== primary.linkedChatId) {
      this.resolver.invalidate(primary.peer);
      return this.readOnly(primary, "DISCUSSION_LINK_CHANGED");
    }

    const discussion = await this.resolver.client.invoke(new Api.messages.GetDiscussionMessage({
      peer: primary.peer, msgId: post.id,
    }));
    const channelId = primary.peer.channelId;
    // VERIFY: msg_id do post NO CANAL não é o id da raiz NO GRUPO. Obter
    // a cópia automaticamente encaminhada e usar o peer/ID dessa cópia.
    // Não presumir messages[0] nem misturar IDs de peers distintos.
    // https://core.telegram.org/api/discussion
    const root = discussion.messages.find((m): m is Api.Message =>
      m instanceof Api.Message && m.peerId instanceof Api.PeerChannel &&
      m.peerId.channelId.toString() === primary.linkedChatId &&
      m.fwdFrom?.channelPost === post.id && m.fwdFrom.fromId instanceof Api.PeerChannel &&
      m.fwdFrom.fromId.channelId.eq(channelId));
    if (!root || !(root.peerId instanceof Api.PeerChannel)) {
      return this.readOnly(primary, "DISCUSSION_ROOT_UNAVAILABLE");
    }
    const linkedId = root.peerId.channelId;
    const chat = discussion.chats.find((c): c is Api.Channel =>
      c instanceof Api.Channel && c.id.eq(linkedId) && !c.min && c.accessHash !== undefined);
    const linkedPeer = chat?.accessHash
      ? new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash })
      : primary.linkedPeer ?? await this.resolver.resolvePeer(new Api.PeerChannel({ channelId: linkedId }));
    const linked = await this.resolver.get(linkedPeer);
    const reason = linked.kind !== "megagroup" ? "INVALID_DISCUSSION_GROUP" : writingProblem(linked, "text", true);
    const expiresAt = Math.min(primary.expiresAt, linked.expiresAt);
    if (reason) return { ...this.readOnly(primary, reason), expiresAt };
    return { capability: "COMMENT_ONLY", destination: primary, actualDestination: linked,
      replyToMsgId: root.id, expiresAt };
  }

  private async latestPost(peer: DestinationPeer): Promise<Api.Message | undefined> {
    const result = await this.resolver.client.invoke(new Api.messages.GetHistory({
      peer, offsetId: 0, offsetDate: 0, addOffset: 0, limit: 100, maxId: 0, minId: 0, hash: bigInt.zero,
    }));
    if (!("messages" in result)) return undefined;
    // O histórico é decrescente. Não procurar um post antigo só porque o mais
    // recente tem comentários desativados; isso mudaria o destino editorial.
    return result.messages.find((m): m is Api.Message => m instanceof Api.Message && Boolean(m.post));
  }

  private async message(peer: DestinationPeer, id: number): Promise<Api.Message | undefined> {
    this.checkMessageId(id);
    const ids = [new Api.InputMessageID({ id })];
    const result = peer instanceof Api.InputPeerChannel
      ? await this.resolver.client.invoke(new Api.channels.GetMessages({ channel: peer, id: ids }))
      : await this.resolver.client.invoke(new Api.messages.GetMessages({ id: ids }));
    if (!("messages" in result)) return undefined;
    return result.messages.find((m): m is Api.Message => m instanceof Api.Message && m.id === id &&
      (peer instanceof Api.InputPeerChannel
        ? m.peerId instanceof Api.PeerChannel && m.peerId.channelId.eq(peer.channelId)
        : m.peerId instanceof Api.PeerChat && m.peerId.chatId.eq(peer.chatId)));
  }

  private async forwardContent(operation: Extract<RouteRequest["operation"], { kind: "forward" }>): Promise<ContentKind> {
    const source = await this.resolver.get(operation.source);
    if (!source.canRead) throw new CapabilityUnavailable("SOURCE_NOT_READABLE");
    if (source.noForwards) throw new CapabilityUnavailable("CHAT_FORWARDS_RESTRICTED");
    const message = await this.message(operation.source, operation.messageId);
    if (!message) throw new CapabilityUnavailable("SOURCE_MESSAGE_UNAVAILABLE");
    if (message.noforwards) throw new CapabilityUnavailable("CHAT_FORWARDS_RESTRICTED");
    const media = message.media;
    if (!media || media instanceof Api.MessageMediaEmpty || media instanceof Api.MessageMediaWebPage) return "text";
    if (media instanceof Api.MessageMediaPhoto) return "photo";
    if (media instanceof Api.MessageMediaPoll) return "poll";
    if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
      const attributes = media.document.attributes;
      if (attributes.some((a) => a instanceof Api.DocumentAttributeSticker)) return "sticker";
      if (attributes.some((a) => a instanceof Api.DocumentAttributeAnimated)) return "gif";
      const video = attributes.find((a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo);
      if (video) return video.roundMessage ? "roundVideo" : "video";
      const audio = attributes.find((a): a is Api.DocumentAttributeAudio => a instanceof Api.DocumentAttributeAudio);
      if (audio) return audio.voice ? "voice" : "audio";
      return "document";
    }
    throw new CapabilityUnavailable("UNSUPPORTED_FORWARD_CONTENT");
  }

  private readOnly(destination: DestinationMetadata, reason: string): CapabilityProfile {
    return { capability: "READ_ONLY", destination, reason, expiresAt: destination.expiresAt };
  }

  private base(request: RouteRequest): ResultBase {
    return { accountId: this.resolver.accountId, targetKey: peerKey(request.target), randomId: request.randomId };
  }

  private skipped(request: RouteRequest, reason: string, recheckAt?: number): RouteResult {
    return { ...this.base(request), status: "SKIPPED_CAPABILITY", sent: false, reason, recheckAt };
  }

  private failureOrSkip(error: unknown, request: RouteRequest, sending: boolean): RouteResult {
    if (isCapabilityError(error)) return this.skipped(request, rpcCode(error), this.resolver.timestamp() + this.resolver.ttlMs);
    const failure = describeFailure(error);
    const code = (error as { code?: unknown } | null)?.code;
    const rejected = failure.retryAfterMs !== undefined || (typeof code === "number" && code >= 400 && code < 500);
    return { ...this.base(request), status: "FAIL", sent: false, ...failure,
      // Timeout de envio tem resultado desconhecido. O retry deve conservar
      // randomId e o destino; trocar de rota só é seguro após recusa explícita.
      deliveryUnknown: sending && !rejected };
  }

  private checkedRandomId(value: string): ReturnType<typeof bigInt> {
    if (!/^-?\d+$/.test(value)) throw new Error("INVALID_RANDOM_ID");
    const id = bigInt(value);
    if (id.isZero() || id.lesser("-9223372036854775808") || id.greater("9223372036854775807")) {
      throw new Error("INVALID_RANDOM_ID");
    }
    return id;
  }

  private checkMessageId(id: number): void {
    if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw new Error("INVALID_MESSAGE_ID");
  }
}
