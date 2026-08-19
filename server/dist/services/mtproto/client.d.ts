import { TelegramClient, Api } from "telegram";
import type { ParsedIdentifier } from "./link-parse.js";
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
export type DialogKind = "contact" | "dm" | "group_member" | "group_admin" | "channel_subscriber" | "channel_owner" | "bot" | "self";
/** Classificação de um peer resolvido pra troca de link no clonador. */
export type PeerKind = "bot" | "group" | "channel" | "user" | "unknown";
export interface MtprotoDialog {
    peerId: string;
    peerType: "user" | "chat" | "channel";
    peerAccessHash: string | null;
    kind: DialogKind;
    title: string;
    username: string | null;
    isBot: boolean;
}
export declare class MtprotoClient {
    private apiId;
    private apiHash;
    private client;
    private inboxHandler;
    private phoneUserCache;
    private linkClassifyCache;
    constructor(apiId: number, apiHash: string, sessionString?: string);
    connect(): Promise<void>;
    /**
     * Health check barato: confirma se a sessão ainda é válida no Telegram.
     * Faz UpdateStatus (offline) — request mínima que toca em auth e não
     * altera estado visível pro user. Se sessão foi revogada/banida, joga
     * AUTH_KEY_UNREGISTERED / USER_DEACTIVATED / SESSION_REVOKED.
     */
    healthCheck(): Promise<void>;
    disconnect(): Promise<void>;
    sendCode(phoneNumber: string): Promise<SendCodeResult>;
    signIn(phoneNumber: string, phoneCodeHash: string, code: string): Promise<SignInResult>;
    signInWithPassword(password: string): Promise<SignInResult>;
    /**
     * Autentica como BOT usando o token do BotFather. Verificado em
     * client/auth.js:361-366 — o gramjs decide por duck-typing: sem
     * `phoneNumber` no objeto, cai em signInBot(), que invoca
     * Api.auth.ImportBotAuthorization. A session string resultante tem o mesmo
     * formato da de conta de usuário (sessions/StringSession.js:91-114).
     */
    signInAsBot(botAuthToken: string): Promise<string>;
    sendMessage(target: string, targetType: "username" | "phone", text: string): Promise<void>;
    /**
     * Manda mensagem pra um peer estruturado salvo no banco (vindo de
     * mtproto_dialogs). Reconstrói o InputPeer correto conforme peer_type
     * — não tenta resolver username nem importar contato.
     */
    sendMessageToPeer(peerId: string, peerType: "user" | "chat" | "channel", peerAccessHash: string | null, text: string): Promise<void>;
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
    listDialogs(): Promise<MtprotoDialog[]>;
    /**
     * Busca os últimos N mensagens recebidas do Telegram oficial (peer 777000).
     * Usado pra popular o histórico quando o cliente abre a inbox pela primeira
     * vez. Retorna do mais recente pro mais antigo.
     */
    getTelegramOfficialHistory(limit?: number): Promise<IncomingMessage[]>;
    /**
     * Liga o listener de novas mensagens vindas do Telegram oficial. Apenas
     * uma instância por client; chamadas subsequentes substituem a handler.
     * Use stopInboxListener pra desligar.
     */
    startInboxListener(onMessage: (msg: IncomingMessage) => void | Promise<void>): void;
    stopInboxListener(): void;
    /**
     * Confere se um canal ainda existe / é acessível pela conta logada.
     * Retorna 'ok' se acessível, ou um motivo de erro normalizado.
     * Usado pelo channel-monitor pra detectar canal banido/excluído.
     */
    getChannelStatus(channelId: string, accessHash: string | null): Promise<{
        ok: true;
        title: string;
        username: string | null;
    } | {
        ok: false;
        reason: "channel_invalid" | "channel_private" | "auth_failed" | "other";
        detail: string;
    }>;
    /**
     * Cria um canal novo. `megagroup: true` cria supergrupo em vez de canal
     * broadcast — usado pela clonagem quando a origem é grupo. `forum: true`
     * já cria o supergrupo com Topics ligado (CreateChannel aceita os dois
     * flags numa chamada só, sem precisar de channels.ToggleForum depois) —
     * só tem efeito com megagroup, nunca com canal broadcast (fórum não
     * existe fora de supergrupo). Pode estourar FLOOD_WAIT se a conta criou
     * muitos canais recentemente.
     */
    createChannel(title: string, about: string, opts?: {
        megagroup?: boolean;
        forum?: boolean;
    }): Promise<{
        channelId: string;
        accessHash: string;
    }>;
    /**
     * Sobe um arquivo que já está em disco. Acima de 20MB o gramjs abre o 3º
     * argumento do CustomFile como CAMINHO (uploads.js:64) — passar o nome ali,
     * como sendMediaToChannel fazia, quebra em arquivo grande.
     */
    uploadFromPath(filePath: string, fileName: string, sizeBytes: number): Promise<Api.TypeInputFile>;
    /**
     * Faz upload de um Buffer e envia como foto ou vídeo pro canal.
     * O caller é responsável por baixar a mídia da URL antes (multi-step
     * porque pode ser URL externa, Supabase Storage signed URL, etc.).
     */
    sendMediaToChannel(channelId: string, accessHash: string, media: {
        buffer: Buffer;
        mimeType: string;
        fileName: string;
    }, caption: string | undefined, kind: "photo" | "video"): Promise<void>;
    /**
     * Envia texto simples pra um canal já criado.
     */
    sendTextToChannel(channelId: string, accessHash: string, text: string): Promise<void>;
    /**
     * Gera um link de convite público (t.me/+xxxx) do canal recém-criado.
     */
    exportChannelInvite(channelId: string, accessHash: string): Promise<string>;
    /**
     * Define a foto de perfil de um canal. O caller passa o Buffer já
     * baixado (vamos sempre baixar via fetch primeiro, do Supabase Storage).
     */
    setChannelPhoto(channelId: string, accessHash: string, photoBuffer: Buffer, fileName?: string): Promise<void>;
    /**
     * Liga ou desliga reações no canal.
     *   enabled=true  → todas as reações permitidas (ChatReactionsAll)
     *   enabled=false → nenhuma reação (ChatReactionsNone)
     */
    setChannelReactions(channelId: string, accessHash: string, enabled: boolean): Promise<void>;
    /**
     * Toggle "proteger conteúdo": quando ligado, ninguém consegue
     * encaminhar/salvar mídias do canal.
     */
    setChannelProtectContent(channelId: string, accessHash: string, enabled: boolean): Promise<void>;
    /** Acesso ao client cru para os adaptadores de clonagem. */
    get raw(): TelegramClient;
    /**
     * Encaminha um lote de mensagens (máx. 100 ids) apagando a autoria, o que
     * remove a marca "encaminhado de" e faz o post sair nativo no destino.
     * `topMsgId` ancora o lote inteiro num tópico de fórum específico do
     * destino — omitido, cai no General (comportamento de sempre).
     */
    forwardBatch(from: Api.TypeInputPeer, to: Api.TypeInputPeer, messageIds: number[], topMsgId?: number): Promise<Api.TypeUpdates>;
    /**
     * Lista os tópicos de fórum de um canal, paginando channels.GetForumTopics
     * (mesmo padrão de listDialogs: pagina internamente, devolve array já
     * montado). Descarta ForumTopicDeleted. O cursor de paginação usa
     * topic.topMessage (id da última mensagem do tópico, muda com o tempo) —
     * NÃO topic.id (identificador permanente do tópico, usado em todo o
     * resto como "id do tópico"/topMsgId). Confundir os dois campos paginaria
     * errado.
     */
    listForumTopics(channelId: string, accessHash: string): Promise<Api.ForumTopic[]>;
    /**
     * Cria um tópico de fórum. iconColor/iconEmojiId replicam o ícone da
     * origem quando presentes — iconEmojiId é opcional no request, então um
     * emoji indisponível (ex.: exige Premium) não deveria impedir a criação
     * do tópico em si.
     */
    createForumTopic(channelId: string, accessHash: string, input: {
        title: string;
        iconColor: number;
        iconEmojiId: string | null;
    }): Promise<number>;
    /** Fecha ou reabre um tópico de fórum. */
    setForumTopicClosed(channelId: string, accessHash: string, topicId: number, closed: boolean): Promise<void>;
    /** Fixa ou desfixa um tópico de fórum. */
    setForumTopicPinned(channelId: string, accessHash: string, topicId: number, pinned: boolean): Promise<void>;
    /** Promove um bot (por @username) a admin de um canal/supergrupo. */
    promoteBotToAdmin(channelId: string, accessHash: string, botUsername: string): Promise<void>;
    /** Define a descrição (about) de um canal/supergrupo. */
    setChannelAbout(channelId: string, accessHash: string, about: string): Promise<void>;
    /**
     * Classifica um identificador de peer (username ou hash de convite, já
     * parseado por link-parse.ts) pra troca de link do clonador. Erro
     * não-flood (username inexistente, convite expirado, etc.) vira
     * "unknown" e é cacheado — erro de flood propaga e NUNCA é cacheado
     * (mesmo idioma de topic-sync.ts: flood é transitório, não deve virar
     * classificação permanente).
     */
    classifyLink(parsed: ParsedIdentifier): Promise<PeerKind>;
}
/** Classifica o resultado de contacts.ResolveUsername. */
export declare function classifyResolvedPeer(result: Api.contacts.TypeResolvedPeer): PeerKind;
/** Classifica o resultado de messages.CheckChatInvite. */
export declare function classifyChatInvite(result: Api.TypeChatInvite): PeerKind;
/**
 * Extrai o id do tópico recém-criado do Updates de channels.CreateForumTopic.
 * A criação produz uma MessageService (não uma Api.Message) — por isso não
 * reaproveita extractNewMessageIds (publish-router.ts), que é Api.Message-only
 * de propósito: generalizar aquela função pra aceitar serviço arriscaria uma
 * update de serviço qualquer ser contada como mensagem copiada na rota de
 * forward, que não tem nada a ver com tópicos.
 */
export declare function extractNewTopicId(updates: Api.TypeUpdates): number | null;
