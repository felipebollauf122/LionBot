import { TelegramClient, Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";
import { CustomFile } from "telegram/client/uploads.js";
import bigInt from "big-integer";

// User ID oficial do Telegram (manda códigos de login, alertas de segurança).
const TELEGRAM_OFFICIAL_USER_ID = "777000";

export interface IncomingMessage {
  tgMessageId: number;
  fromPeerId: string;
  fromPeerName: string | null;
  text: string;
  receivedAt: Date;
}

export interface SendCodeResult {
  phoneCodeHash: string;
}

export interface SignInResult {
  ok: boolean;
  needsPassword: boolean;
  sessionString?: string;
}

export type DialogKind =
  | "contact"
  | "dm"
  | "group_member"
  | "group_admin"
  | "channel_subscriber"
  | "channel_owner"
  | "bot"
  | "self";

export interface MtprotoDialog {
  peerId: string;
  peerType: "user" | "chat" | "channel";
  peerAccessHash: string | null;
  kind: DialogKind;
  title: string;
  username: string | null;
  isBot: boolean;
}

export class MtprotoClient {
  private client: TelegramClient;
  private inboxHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;

  constructor(
    private apiId: number,
    private apiHash: string,
    sessionString: string = "",
  ) {
    this.client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
    });
  }

  async connect(): Promise<void> {
    if (!this.client.connected) {
      await this.client.connect();
    }
  }

  /**
   * Health check barato: confirma se a sessão ainda é válida no Telegram.
   * Faz UpdateStatus (offline) — request mínima que toca em auth e não
   * altera estado visível pro user. Se sessão foi revogada/banida, joga
   * AUTH_KEY_UNREGISTERED / USER_DEACTIVATED / SESSION_REVOKED.
   */
  async healthCheck(): Promise<void> {
    await this.connect();
    await this.client.invoke(new Api.account.UpdateStatus({ offline: true }));
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async sendCode(phoneNumber: string): Promise<SendCodeResult> {
    await this.connect();
    const result = await this.client.sendCode(
      { apiId: this.apiId, apiHash: this.apiHash },
      phoneNumber,
    );
    return { phoneCodeHash: result.phoneCodeHash };
  }

  async signIn(
    phoneNumber: string,
    phoneCodeHash: string,
    code: string,
  ): Promise<SignInResult> {
    try {
      await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode: code,
        }),
      );
      const sessionString = (this.client.session as StringSession).save();
      return { ok: true, needsPassword: false, sessionString };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SESSION_PASSWORD_NEEDED")) {
        return { ok: false, needsPassword: true };
      }
      throw err;
    }
  }

  async signInWithPassword(password: string): Promise<SignInResult> {
    await this.client.signInUser(
      { apiId: this.apiId, apiHash: this.apiHash },
      {
        phoneNumber: async () => "",
        phoneCode: async () => "",
        password: async () => password,
        onError: (e) => { throw e; },
      },
    );
    const sessionString = (this.client.session as StringSession).save();
    return { ok: true, needsPassword: false, sessionString };
  }

  async sendMessage(
    target: string,
    targetType: "username" | "phone",
    text: string,
  ): Promise<void> {
    await this.connect();

    if (targetType === "username") {
      await this.client.sendMessage(target, { message: text });
      return;
    }

    const imported = await this.client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: bigInt(Date.now()),
            phone: target,
            firstName: "lead",
            lastName: "",
          }),
        ],
      }),
    );
    const user = imported.users[0];
    if (!user) throw new Error("PHONE_NOT_ON_TELEGRAM");
    await this.client.sendMessage(user as never, { message: text });
  }

  /**
   * Manda mensagem pra um peer estruturado salvo no banco (vindo de
   * mtproto_dialogs). Reconstrói o InputPeer correto conforme peer_type
   * — não tenta resolver username nem importar contato.
   */
  async sendMessageToPeer(
    peerId: string,
    peerType: "user" | "chat" | "channel",
    peerAccessHash: string | null,
    text: string,
  ): Promise<void> {
    await this.connect();

    let inputPeer;
    if (peerType === "user") {
      if (!peerAccessHash) throw new Error("USER_PEER_MISSING_ACCESS_HASH");
      inputPeer = new Api.InputPeerUser({
        userId: bigInt(peerId),
        accessHash: bigInt(peerAccessHash),
      });
    } else if (peerType === "chat") {
      // Grupos legacy não têm access_hash
      inputPeer = new Api.InputPeerChat({ chatId: bigInt(peerId) });
    } else {
      if (!peerAccessHash) throw new Error("CHANNEL_PEER_MISSING_ACCESS_HASH");
      inputPeer = new Api.InputPeerChannel({
        channelId: bigInt(peerId),
        accessHash: bigInt(peerAccessHash),
      });
    }

    await this.client.sendMessage(inputPeer as never, { message: text });
  }

  /**
   * Sincroniza dialogs e contatos da conta com o servidor do Telegram.
   *
   * Retorna lista normalizada de todos os peers conhecidos:
   *   - Contatos da agenda (mesmo sem DM aberto)
   *   - DMs (conversas privadas abertas)
   *   - Grupos (legacy chats) — separa member/admin pelo creator/admin_rights
   *   - Channels & supergroups — separa owner/subscriber pelo creator
   *
   * Custo: pode levar 30s+ em contas com 5k+ dialogs. Chamado sob demanda.
   */
  async listDialogs(): Promise<MtprotoDialog[]> {
    await this.connect();

    const out: MtprotoDialog[] = [];
    const seenUsers = new Set<string>();
    const seenChats = new Set<string>();
    const seenChannels = new Set<string>();

    // 1. Pega contatos (gente que está na agenda mesmo sem DM aberto)
    try {
      const contactsResult = await this.client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }));
      if (contactsResult instanceof Api.contacts.Contacts) {
        for (const user of contactsResult.users) {
          if (!(user instanceof Api.User) || !user.accessHash) continue;
          const peerId = String(user.id);
          if (seenUsers.has(peerId)) continue;
          seenUsers.add(peerId);
          if (user.self) {
            out.push({
              peerId,
              peerType: "user",
              peerAccessHash: String(user.accessHash),
              kind: "self",
              title: "Saved Messages",
              username: user.username ?? null,
              isBot: false,
            });
            continue;
          }
          if (user.bot) {
            out.push({
              peerId,
              peerType: "user",
              peerAccessHash: String(user.accessHash),
              kind: "bot",
              title: [user.firstName, user.lastName].filter(Boolean).join(" ") || (user.username ?? peerId),
              username: user.username ?? null,
              isBot: true,
            });
            continue;
          }
          out.push({
            peerId,
            peerType: "user",
            peerAccessHash: String(user.accessHash),
            kind: "contact",
            title: [user.firstName, user.lastName].filter(Boolean).join(" ") || (user.username ?? peerId),
            username: user.username ?? null,
            isBot: false,
          });
        }
      }
    } catch (err) {
      console.error("[mtproto.client] listDialogs: contacts.GetContacts failed:", err);
    }

    // 2. Pega dialogs (DMs, grupos, canais) — pagina pra cobrir contas com muitos dialogs
    const dialogLimit = 100;
    let offsetDate = 0;
    let offsetId = 0;
    let offsetPeer: Api.TypeInputPeer = new Api.InputPeerEmpty();
    let hasMore = true;
    const maxIterations = 50; // limite de segurança: até 5000 dialogs
    let iter = 0;

    while (hasMore && iter < maxIterations) {
      iter++;
      let result;
      try {
        result = await this.client.invoke(
          new Api.messages.GetDialogs({
            offsetDate,
            offsetId,
            offsetPeer,
            limit: dialogLimit,
            hash: bigInt(0),
          }),
        );
      } catch (err) {
        console.error("[mtproto.client] listDialogs: messages.GetDialogs failed:", err);
        break;
      }

      if (
        !(result instanceof Api.messages.Dialogs) &&
        !(result instanceof Api.messages.DialogsSlice)
      ) {
        break;
      }

      const dialogList: unknown[] = result.dialogs;
      const userList: unknown[] = result.users;
      const chatList: unknown[] = result.chats;
      const messageList: unknown[] = result.messages;

      // Index users e chats por id pra resolver acessHash dos dialogs
      const userMap = new Map<string, Api.User>();
      for (const u of userList) {
        if (u instanceof Api.User) userMap.set(String(u.id), u);
      }
      const chatMap = new Map<string, Api.Chat | Api.Channel | Api.ChatForbidden | Api.ChannelForbidden>();
      for (const c of chatList) {
        if (
          c instanceof Api.Chat ||
          c instanceof Api.Channel ||
          c instanceof Api.ChatForbidden ||
          c instanceof Api.ChannelForbidden
        ) {
          chatMap.set(String(c.id), c);
        }
      }

      for (const dialog of dialogList) {
        if (!(dialog instanceof Api.Dialog)) continue;
        const dialogPeer = dialog.peer;

        if (dialogPeer instanceof Api.PeerUser) {
          const userId = String(dialogPeer.userId);
          if (seenUsers.has(userId)) continue;
          const u = userMap.get(userId);
          if (!u || !u.accessHash) continue;
          seenUsers.add(userId);
          if (u.self) {
            out.push({
              peerId: userId,
              peerType: "user",
              peerAccessHash: String(u.accessHash),
              kind: "self",
              title: "Saved Messages",
              username: u.username ?? null,
              isBot: false,
            });
            continue;
          }
          if (u.bot) {
            out.push({
              peerId: userId,
              peerType: "user",
              peerAccessHash: String(u.accessHash),
              kind: "bot",
              title: [u.firstName, u.lastName].filter(Boolean).join(" ") || (u.username ?? userId),
              username: u.username ?? null,
              isBot: true,
            });
            continue;
          }
          out.push({
            peerId: userId,
            peerType: "user",
            peerAccessHash: String(u.accessHash),
            kind: "dm",
            title: [u.firstName, u.lastName].filter(Boolean).join(" ") || (u.username ?? userId),
            username: u.username ?? null,
            isBot: false,
          });
        } else if (dialogPeer instanceof Api.PeerChat) {
          const chatId = String(dialogPeer.chatId);
          if (seenChats.has(chatId)) continue;
          const c = chatMap.get(chatId);
          if (!c || c instanceof Api.ChatForbidden || c instanceof Api.ChannelForbidden) continue;
          if (!(c instanceof Api.Chat)) continue;
          seenChats.add(chatId);
          const isAdmin = Boolean(c.creator || (c.adminRights && c.adminRights.postMessages));
          out.push({
            peerId: chatId,
            peerType: "chat",
            peerAccessHash: null,
            kind: isAdmin ? "group_admin" : "group_member",
            title: c.title || chatId,
            username: null,
            isBot: false,
          });
        } else if (dialogPeer instanceof Api.PeerChannel) {
          const channelId = String(dialogPeer.channelId);
          if (seenChannels.has(channelId)) continue;
          const c = chatMap.get(channelId);
          if (!c || c instanceof Api.ChatForbidden || c instanceof Api.ChannelForbidden) continue;
          if (!(c instanceof Api.Channel) || !c.accessHash) continue;
          seenChannels.add(channelId);
          const isBroadcast = Boolean(c.broadcast);
          const isOwnerOrAdmin = Boolean(c.creator || (c.adminRights && c.adminRights.postMessages));
          let kind: DialogKind;
          if (isBroadcast) {
            kind = isOwnerOrAdmin ? "channel_owner" : "channel_subscriber";
          } else {
            // megagroup / supergroup
            kind = isOwnerOrAdmin ? "group_admin" : "group_member";
          }
          out.push({
            peerId: channelId,
            peerType: "channel",
            peerAccessHash: String(c.accessHash),
            kind,
            title: c.title || channelId,
            username: c.username ?? null,
            isBot: false,
          });
        }
      }

      // Decide se continua paginando
      if (
        result instanceof Api.messages.DialogsSlice &&
        dialogList.length === dialogLimit
      ) {
        const lastDialog = dialogList[dialogList.length - 1];
        if (lastDialog instanceof Api.Dialog) {
          const lastMessageId = lastDialog.topMessage;
          const lastMessage = messageList.find(
            (m) =>
              (m instanceof Api.Message || m instanceof Api.MessageService) &&
              (m as Api.Message | Api.MessageService).id === lastMessageId,
          );
          if (
            lastMessage instanceof Api.Message ||
            lastMessage instanceof Api.MessageService
          ) {
            offsetDate = lastMessage.date;
            offsetId = lastMessage.id;
          }
          const lastPeer = lastDialog.peer;
          if (lastPeer instanceof Api.PeerUser) {
            const u = userMap.get(String(lastPeer.userId));
            if (u && u.accessHash) {
              offsetPeer = new Api.InputPeerUser({
                userId: u.id,
                accessHash: u.accessHash,
              });
            } else {
              hasMore = false;
            }
          } else if (lastPeer instanceof Api.PeerChat) {
            offsetPeer = new Api.InputPeerChat({ chatId: lastPeer.chatId });
          } else if (lastPeer instanceof Api.PeerChannel) {
            const c = chatMap.get(String(lastPeer.channelId));
            if (c instanceof Api.Channel && c.accessHash) {
              offsetPeer = new Api.InputPeerChannel({
                channelId: c.id,
                accessHash: c.accessHash,
              });
            } else {
              hasMore = false;
            }
          }
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    return out;
  }

  /**
   * Busca os últimos N mensagens recebidas do Telegram oficial (peer 777000).
   * Usado pra popular o histórico quando o cliente abre a inbox pela primeira
   * vez. Retorna do mais recente pro mais antigo.
   */
  async getTelegramOfficialHistory(limit = 50): Promise<IncomingMessage[]> {
    await this.connect();
    const peer = new Api.InputPeerUser({
      userId: bigInt(TELEGRAM_OFFICIAL_USER_ID),
      accessHash: bigInt(0),
    });
    const result = await this.client.invoke(
      new Api.messages.GetHistory({
        peer,
        limit,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      }),
    );
    const messages =
      result instanceof Api.messages.Messages ||
      result instanceof Api.messages.MessagesSlice ||
      result instanceof Api.messages.ChannelMessages
        ? result.messages
        : [];
    const out: IncomingMessage[] = [];
    for (const m of messages) {
      if (!(m instanceof Api.Message)) continue;
      if (!m.message) continue;
      out.push({
        tgMessageId: m.id,
        fromPeerId: TELEGRAM_OFFICIAL_USER_ID,
        fromPeerName: "Telegram",
        text: m.message,
        receivedAt: new Date(m.date * 1000),
      });
    }
    return out;
  }

  /**
   * Liga o listener de novas mensagens vindas do Telegram oficial. Apenas
   * uma instância por client; chamadas subsequentes substituem a handler.
   * Use stopInboxListener pra desligar.
   */
  startInboxListener(onMessage: (msg: IncomingMessage) => void | Promise<void>): void {
    if (this.inboxHandler) {
      this.client.removeEventHandler(this.inboxHandler, new NewMessage({}));
      this.inboxHandler = null;
    }
    const handler = async (event: NewMessageEvent): Promise<void> => {
      const msg = event.message;
      if (!msg || !(msg instanceof Api.Message)) return;
      if (!msg.message) return;
      // Filtra apenas msgs do user 777000 (Telegram oficial)
      const sender = msg.peerId;
      let fromId: string | null = null;
      if (sender instanceof Api.PeerUser) {
        fromId = sender.userId.toString();
      }
      if (fromId !== TELEGRAM_OFFICIAL_USER_ID) return;
      await onMessage({
        tgMessageId: msg.id,
        fromPeerId: TELEGRAM_OFFICIAL_USER_ID,
        fromPeerName: "Telegram",
        text: msg.message,
        receivedAt: new Date(msg.date * 1000),
      });
    };
    this.inboxHandler = handler;
    this.client.addEventHandler(handler, new NewMessage({}));
  }

  stopInboxListener(): void {
    if (!this.inboxHandler) return;
    this.client.removeEventHandler(this.inboxHandler, new NewMessage({}));
    this.inboxHandler = null;
  }

  /**
   * Confere se um canal ainda existe / é acessível pela conta logada.
   * Retorna 'ok' se acessível, ou um motivo de erro normalizado.
   * Usado pelo channel-monitor pra detectar canal banido/excluído.
   */
  async getChannelStatus(channelId: string, accessHash: string | null): Promise<
    | { ok: true; title: string; username: string | null }
    | { ok: false; reason: "channel_invalid" | "channel_private" | "auth_failed" | "other"; detail: string }
  > {
    try {
      await this.connect();
      const inputChannel = new Api.InputChannel({
        channelId: bigInt(channelId),
        accessHash: accessHash ? bigInt(accessHash) : bigInt(0),
      });
      const result = await this.client.invoke(
        new Api.channels.GetChannels({ id: [inputChannel] }),
      );
      const chats =
        result instanceof Api.messages.Chats || result instanceof Api.messages.ChatsSlice
          ? result.chats
          : [];
      const channel = chats[0];
      if (!channel) {
        return { ok: false, reason: "channel_invalid", detail: "no channel returned" };
      }
      if (channel instanceof Api.ChannelForbidden) {
        return { ok: false, reason: "channel_private", detail: "ChannelForbidden" };
      }
      if (channel instanceof Api.Channel) {
        return { ok: true, title: channel.title, username: channel.username ?? null };
      }
      return { ok: false, reason: "other", detail: `unexpected chat type: ${channel.className}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/AUTH_KEY|USER_DEACTIVATED|SESSION_REVOKED|PHONE_NUMBER_BANNED/i.test(msg)) {
        return { ok: false, reason: "auth_failed", detail: msg };
      }
      if (/CHANNEL_INVALID|CHANNEL_PRIVATE|CHAT_FORBIDDEN/i.test(msg)) {
        return { ok: false, reason: "channel_invalid", detail: msg };
      }
      return { ok: false, reason: "other", detail: msg };
    }
  }

  /**
   * Cria um canal novo (broadcast) com título + about. Retorna identidade
   * do canal pra postar e exportar link de convite. Pode estourar FLOOD_WAIT
   * se a conta criou muitos canais recentemente.
   */
  async createChannel(title: string, about: string): Promise<{
    channelId: string;
    accessHash: string;
  }> {
    await this.connect();
    const result = await this.client.invoke(
      new Api.channels.CreateChannel({
        title,
        about,
        broadcast: true,
        megagroup: false,
      }),
    );
    if (
      !(result instanceof Api.Updates) &&
      !(result instanceof Api.UpdatesCombined)
    ) {
      throw new Error(`createChannel: unexpected return type ${(result as Api.TypeUpdates).className}`);
    }
    const channel = result.chats.find(
      (c): c is Api.Channel => c instanceof Api.Channel,
    );
    if (!channel || !channel.accessHash) {
      throw new Error("createChannel: no channel in response");
    }
    return {
      channelId: channel.id.toString(),
      accessHash: channel.accessHash.toString(),
    };
  }

  /**
   * Faz upload de um Buffer e envia como foto ou vídeo pro canal.
   * O caller é responsável por baixar a mídia da URL antes (multi-step
   * porque pode ser URL externa, Supabase Storage signed URL, etc.).
   */
  async sendMediaToChannel(
    channelId: string,
    accessHash: string,
    media: { buffer: Buffer; mimeType: string; fileName: string },
    caption: string | undefined,
    kind: "photo" | "video",
  ): Promise<void> {
    await this.connect();
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    const file = await this.client.uploadFile({
      file: new CustomFile(media.fileName, media.buffer.length, media.fileName, media.buffer),
      workers: 1,
    });
    if (kind === "photo") {
      await this.client.invoke(
        new Api.messages.SendMedia({
          peer,
          media: new Api.InputMediaUploadedPhoto({ file }),
          message: caption ?? "",
          randomId: bigInt(Math.floor(Math.random() * 1e15)),
        }),
      );
    } else {
      await this.client.invoke(
        new Api.messages.SendMedia({
          peer,
          media: new Api.InputMediaUploadedDocument({
            file,
            mimeType: media.mimeType,
            attributes: [
              new Api.DocumentAttributeFilename({ fileName: media.fileName }),
              new Api.DocumentAttributeVideo({
                duration: 0,
                w: 1280,
                h: 720,
                supportsStreaming: true,
              }),
            ],
          }),
          message: caption ?? "",
          randomId: bigInt(Math.floor(Math.random() * 1e15)),
        }),
      );
    }
  }

  /**
   * Envia texto simples pra um canal já criado.
   */
  async sendTextToChannel(
    channelId: string,
    accessHash: string,
    text: string,
  ): Promise<void> {
    await this.connect();
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    await this.client.invoke(
      new Api.messages.SendMessage({
        peer,
        message: text,
        randomId: bigInt(Math.floor(Math.random() * 1e15)),
      }),
    );
  }

  /**
   * Gera um link de convite público (t.me/+xxxx) do canal recém-criado.
   */
  async exportChannelInvite(channelId: string, accessHash: string): Promise<string> {
    await this.connect();
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    const result = await this.client.invoke(
      new Api.messages.ExportChatInvite({ peer }),
    );
    if (result instanceof Api.ChatInviteExported) return result.link;
    throw new Error(`exportChatInvite: unexpected return ${result.className}`);
  }

  /**
   * Define a foto de perfil de um canal. O caller passa o Buffer já
   * baixado (vamos sempre baixar via fetch primeiro, do Supabase Storage).
   */
  async setChannelPhoto(
    channelId: string,
    accessHash: string,
    photoBuffer: Buffer,
    fileName: string = "channel_photo.jpg",
  ): Promise<void> {
    await this.connect();
    const uploaded = await this.client.uploadFile({
      file: new CustomFile(fileName, photoBuffer.length, fileName, photoBuffer),
      workers: 1,
    });
    const channel = new Api.InputChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    await this.client.invoke(
      new Api.channels.EditPhoto({
        channel,
        photo: new Api.InputChatUploadedPhoto({ file: uploaded }),
      }),
    );
  }

  /**
   * Liga ou desliga reações no canal.
   *   enabled=true  → todas as reações permitidas (ChatReactionsAll)
   *   enabled=false → nenhuma reação (ChatReactionsNone)
   */
  async setChannelReactions(
    channelId: string,
    accessHash: string,
    enabled: boolean,
  ): Promise<void> {
    await this.connect();
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    await this.client.invoke(
      new Api.messages.SetChatAvailableReactions({
        peer,
        availableReactions: enabled
          ? new Api.ChatReactionsAll({ allowCustom: true })
          : new Api.ChatReactionsNone(),
      }),
    );
  }

  /**
   * Toggle "proteger conteúdo": quando ligado, ninguém consegue
   * encaminhar/salvar mídias do canal.
   */
  async setChannelProtectContent(
    channelId: string,
    accessHash: string,
    enabled: boolean,
  ): Promise<void> {
    await this.connect();
    const channel = new Api.InputChannel({
      channelId: bigInt(channelId),
      accessHash: bigInt(accessHash),
    });
    await this.client.invoke(
      new Api.messages.ToggleNoForwards({
        peer: new Api.InputPeerChannel({
          channelId: channel.channelId,
          accessHash: channel.accessHash,
        }),
        enabled,
      }),
    );
  }
}
