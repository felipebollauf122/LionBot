import { Api, type TelegramClient } from "telegram";
import { CapabilityUnavailable, type PermissionRefusal } from "./capability-errors.js";

export type DestinationPeer = Api.InputPeerChannel | Api.InputPeerChat;
export type CapabilityClient = Pick<TelegramClient, "invoke" | "getInputEntity">;
export type ContentKind =
  | "text" | "photo" | "video" | "roundVideo" | "audio" | "voice"
  | "document" | "sticker" | "gif" | "poll";

const CONTENT_RIGHTS = {
  text: "sendPlain", photo: "sendPhotos", video: "sendVideos",
  roundVideo: "sendRoundvideos", audio: "sendAudios", voice: "sendVoices",
  document: "sendDocs", sticker: "sendStickers", gif: "sendGifs", poll: "sendPolls",
} as const satisfies Record<ContentKind, keyof Api.ChatBannedRights>;

export interface DestinationMetadata {
  peer: DestinationPeer;
  key: string;
  kind: "channel" | "megagroup" | "chat";
  isMember: boolean;
  isAdmin: boolean;
  isForum: boolean;
  joinToSend: boolean;
  noForwards: boolean;
  canRead: boolean;
  /** Direitos de conteúdo; verificar também isMember/joinToSend antes de rotear. */
  allowed: Readonly<Record<ContentKind, boolean>>;
  canSendMessages: boolean;
  canSendMedia: boolean;
  canSendStickers: boolean;
  linkedChatId?: string;
  linkedPeer?: DestinationPeer;
  blockedReason?: string;
  observedRefusal?: { code: PermissionRefusal; until: number };
  expiresAt: number;
}

export function peerKey(peer: DestinationPeer): string {
  return peer instanceof Api.InputPeerChannel
    ? `channel:${peer.channelId.toString()}` : `chat:${peer.chatId.toString()}`;
}

/** Pure: interpreta os campos efetivamente presentes no GramJS 2.26.22. */
export function permissionsForChat(chat: Api.Channel | Api.Chat) {
  const channel = chat instanceof Api.Channel;
  const isAdmin = Boolean(chat.creator || chat.adminRights);
  const own = channel ? chat.bannedRights : undefined;
  // VERIFY: adminRights é Api.ChatAdminRights, com booleanos opcionais; não
  // fazer operações bitwise. Em broadcast, ser admin por outro direito não
  // basta: creator OU adminRights.postMessages precisa estar ativo.
  // https://core.telegram.org/constructor/chatAdminRights
  const canPostBroadcast = Boolean(chat.creator || chat.adminRights?.postMessages);
  const defaults = isAdmin ? undefined : chat.defaultBannedRights;
  const banned = (right: keyof Api.ChatBannedRights) => own?.[right] === true || defaults?.[right] === true;
  let blockedReason: string | undefined;
  if (own?.viewMessages) blockedReason = "USER_BANNED_IN_CHANNEL";
  else if (channel && chat.min) blockedReason = "INCOMPLETE_CHANNEL_METADATA";
  else if (channel && !chat.broadcast && !chat.megagroup && !chat.gigagroup) blockedReason = "UNKNOWN_CHANNEL_TYPE";
  else if (channel && chat.restricted) blockedReason = "CHAT_RESTRICTED";
  else if (!channel && chat.deactivated) blockedReason = "CHAT_DEACTIVATED";
  else if (!channel && chat.migratedTo) blockedReason = "CHAT_MIGRATED";
  else if (channel && chat.broadcast && !canPostBroadcast) blockedReason = "CHAT_ADMIN_REQUIRED";
  else if (channel && chat.gigagroup && !isAdmin) blockedReason = "CHAT_ADMIN_REQUIRED";
  else if (banned("sendMessages")) blockedReason = "CHAT_WRITE_FORBIDDEN";

  // VERIFY: canSendMessages/canSendMedia/canSendStickers NÃO são campos do
  // Api.Channel/Api.Chat instalado. Derivamos direitos positivos daqui.
  // Em ChatBannedRights, true significa PROIBIDO, inclusive sendPlain.
  const allowed = {} as Record<ContentKind, boolean>;
  for (const kind of Object.keys(CONTENT_RIGHTS) as ContentKind[]) {
    const media = kind !== "text" && kind !== "poll";
    allowed[kind] = !blockedReason && !banned(CONTENT_RIGHTS[kind]) && !(media && banned("sendMedia"));
  }
  return {
    isAdmin,
    isMember: !chat.left,
    canRead: !own?.viewMessages && !(channel && chat.restricted),
    blockedReason,
    allowed,
    canSendMessages: !blockedReason,
    // Conservador: all-media só é true se todos estes subtipos são permitidos.
    canSendMedia: (["photo", "video", "roundVideo", "audio", "voice", "document"] as const)
      .every((kind) => allowed[kind]),
    canSendStickers: allowed.sticker,
  };
}

interface CacheEntry {
  value?: DestinationMetadata;
  pending?: Promise<DestinationMetadata>;
}

/** Uma instância por conta/sessão: nunca compartilhar access_hash entre contas. */
export class CapabilityResolver {
  readonly ttlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly refusals = new Map<string, { code: PermissionRefusal; until: number }>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(
    readonly accountId: string,
    readonly client: CapabilityClient,
    options: { ttlMs?: number; now?: () => number; maxEntries?: number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 2_000;
    if (!accountId || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0 ||
        !Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("Invalid capability cache configuration");
    }
  }

  timestamp(): number { return this.now(); }

  async resolvePeer(entity: Api.TypeEntityLike): Promise<DestinationPeer> {
    const peer = await this.client.getInputEntity(entity);
    if (!(peer instanceof Api.InputPeerChannel) && !(peer instanceof Api.InputPeerChat)) {
      throw new CapabilityUnavailable("UNSUPPORTED_DESTINATION_TYPE");
    }
    return peer;
  }

  invalidate(peer: DestinationPeer): void {
    this.cache.delete(this.cacheKey(peer));
  }

  recordRefusal(peer: DestinationPeer, code: PermissionRefusal): void {
    const key = this.cacheKey(peer);
    this.invalidate(peer);
    this.refusals.delete(key);
    this.refusals.set(key, { code, until: this.now() + this.ttlMs });
    this.trim(this.refusals);
  }

  clear(): void {
    this.cache.clear();
    this.refusals.clear();
  }

  async get(peer: DestinationPeer): Promise<DestinationMetadata> {
    const key = this.cacheKey(peer);
    const cached = this.cache.get(key);
    if (cached?.value && cached.value.expiresAt > this.now()) return this.withRefusal(cached.value);
    if (cached?.pending) return this.withRefusal(await cached.pending);

    const entry: CacheEntry = {};
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.trim(this.cache);
    const pending = this.load(peer);
    entry.pending = pending;
    try {
      const value = await pending;
      // Um RPC iniciado antes de invalidate() não pode repovoar o cache.
      if (this.cache.get(key) === entry) {
        entry.value = value;
        entry.pending = undefined;
      }
      return this.withRefusal(value);
    } catch (error) {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      throw error; // Erros de rede/flood não viram um perfil READ_ONLY falso.
    }
  }

  private cacheKey(peer: DestinationPeer): string { return `${this.accountId}:${peerKey(peer)}`; }

  private trim<T>(map: Map<string, T>): void {
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private withRefusal(value: DestinationMetadata): DestinationMetadata {
    const key = this.cacheKey(value.peer);
    const refusal = this.refusals.get(key);
    if (refusal && refusal.until <= this.now()) this.refusals.delete(key);
    // Metadados podem continuar otimistas após uma recusa. Conservamos a
    // evidência do envio por um TTL, sem marcar o destino como morto para sempre.
    const observedRefusal = refusal && refusal.until > this.now() ? refusal : undefined;
    return { ...value, observedRefusal };
  }

  private async load(peer: DestinationPeer): Promise<DestinationMetadata> {
    const isChannel = peer instanceof Api.InputPeerChannel;
    const result = isChannel
      ? await this.client.invoke(new Api.channels.GetFullChannel({ channel: peer }))
      : await this.client.invoke(new Api.messages.GetFullChat({ chatId: peer.chatId }));
    const id = isChannel ? peer.channelId : peer.chatId;
    // VERIFY: o retorno é messages.ChatFull { fullChat, chats, users }.
    // Direitos estão no elemento CORRESPONDENTE de chats, não em fullChat
    // nem necessariamente em chats[0]; linkedChatId está em fullChat.
    const chat = result.chats.find((item) => item.id.eq(id) &&
      (isChannel ? item instanceof Api.Channel : item instanceof Api.Chat));
    if (!(chat instanceof Api.Channel) && !(chat instanceof Api.Chat)) {
      throw new CapabilityUnavailable("CHAT_METADATA_UNAVAILABLE");
    }
    const full = result.fullChat;
    let linkedPeer: DestinationPeer | undefined;
    if (chat instanceof Api.Channel && chat.broadcast && full instanceof Api.ChannelFull && full.linkedChatId) {
      const linked = result.chats.find((item) => item instanceof Api.Channel && item.id.eq(full.linkedChatId!));
      if (linked instanceof Api.Channel && linked.accessHash && !linked.min) {
        linkedPeer = new Api.InputPeerChannel({ channelId: linked.id, accessHash: linked.accessHash });
      }
      // Sem hash no retorno, o router resolve o peer com os dados da discussão;
      // nunca inventa accessHash=0 nem empresta o hash de outra conta.
    }
    const rights = permissionsForChat(chat);
    return {
      peer, key: peerKey(peer), ...rights,
      // VERIFY: chat.type não existe aqui; Api.Channel cobre broadcast e megagroup.
      kind: chat instanceof Api.Chat ? "chat" : chat.megagroup ? "megagroup" : "channel",
      isForum: chat instanceof Api.Channel && Boolean(chat.forum),
      // VERIFY: o nome instalado é joinToSend; joinToSendMessages não existe.
      joinToSend: chat instanceof Api.Channel && Boolean(chat.joinToSend),
      noForwards: Boolean(chat.noforwards),
      linkedChatId: full instanceof Api.ChannelFull ? full.linkedChatId?.toString() : undefined,
      linkedPeer,
      expiresAt: this.now() + this.ttlMs,
    };
  }
}
