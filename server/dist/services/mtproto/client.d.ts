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
     * Cria um canal novo (broadcast) com título + about. Retorna identidade
     * do canal pra postar e exportar link de convite. Pode estourar FLOOD_WAIT
     * se a conta criou muitos canais recentemente.
     */
    createChannel(title: string, about: string): Promise<{
        channelId: string;
        accessHash: string;
    }>;
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
}
