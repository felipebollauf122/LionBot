import { Api } from "telegram";
import { MtprotoClient } from "../client.js";
import type { CloneMediaKind } from "./media-plan.js";
export interface BotValidationDeps {
    getMe(token: string): Promise<{
        id: number;
        username?: string;
        is_bot: boolean;
    }>;
}
export type BotValidation = {
    ok: true;
    botUserId: string;
    username: string;
} | {
    ok: false;
    error: string;
};
export declare const defaultBotValidationDeps: BotValidationDeps;
/**
 * Valida o token colado pelo owner. Username é obrigatório porque a promoção
 * a admin resolve o bot por @username (contacts.ResolveUsername).
 */
export declare function validateBotToken(token: string, deps?: BotValidationDeps): Promise<BotValidation>;
export interface InlineLink {
    label: string;
    url: string;
}
/**
 * Só botões de URL sobrevivem à clonagem: callback pertence ao bot que criou
 * a mensagem original e não funciona fora dele.
 */
export declare function buildInlineKeyboard(links: InlineLink[]): {
    inline_keyboard: Array<Array<{
        text: string;
        url: string;
    }>>;
};
export interface PublishOptions {
    replyToMessageId?: number;
    /** Entidades gramjs cruas (Api.MessageEntity*); convertidas via toBotApiEntities antes de ir pro grammy. */
    entities?: Api.TypeMessageEntity[];
    inlineLinks?: InlineLink[];
    /** Nome original do arquivo (DocumentAttributeFilename da origem), quando existir. */
    fileName?: string;
    /** Id do tópico de fórum de destino (message_thread_id da Bot API). Omitido = General. */
    messageThreadId?: number;
}
/**
 * Enquete lida da origem (Api.MessageMediaPoll), já no shape mínimo pra
 * recriar via Bot API sendPoll. Produzida por SourceReader.pollData.
 */
export interface SourcePoll {
    question: string;
    options: string[];
    isAnonymous: boolean;
    allowsMultipleAnswers: boolean;
}
export interface BotMtprotoCreds {
    apiId: number;
    apiHash: string;
}
/**
 * Publicador do clone. Bot API para o caso comum; cliente MTProto de bot
 * apenas para o que a Bot API não cobre.
 */
export declare class CompanionBot {
    private token;
    /** chat_id no formato do Bot API: -100<channelId> para canal/supergrupo. */
    private destChatId;
    private sessionString;
    /**
     * Credenciais MTProto do app. Injetadas em vez de importadas de config.ts
     * porque aquele modulo dispara assert de env no import, o que prendia os
     * testes puros deste arquivo a ter SUPABASE_URL no ambiente.
     */
    private creds;
    private bot;
    private mt;
    constructor(token: string, 
    /** chat_id no formato do Bot API: -100<channelId> para canal/supergrupo. */
    destChatId: string, sessionString?: string | null, 
    /**
     * Credenciais MTProto do app. Injetadas em vez de importadas de config.ts
     * porque aquele modulo dispara assert de env no import, o que prendia os
     * testes puros deste arquivo a ter SUPABASE_URL no ambiente.
     */
    creds?: BotMtprotoCreds | null);
    static destChatIdFromChannelId(channelId: string): string;
    publishText(text: string, opts?: PublishOptions): Promise<number>;
    publishMedia(filePath: string, kind: CloneMediaKind, caption: string, opts?: PublishOptions): Promise<number>;
    /** Álbum. O caller já fatiou em no máximo 10 itens. */
    publishAlbum(items: Array<{
        filePath: string;
        kind: "photo" | "video";
        caption: string;
        entities?: Api.TypeMessageEntity[];
    }>, 
    /**
     * Opcional, sem default de reply: o Telegram ancora o reply no primeiro
     * item do álbum automaticamente, então o caller só precisa passar o id.
     */
    opts?: {
        replyToMessageId?: number;
        messageThreadId?: number;
    }): Promise<number[]>;
    /**
     * Recria a enquete (defeito I7): a rota download não tinha como reproduzir
     * `{kind:"poll"}` do media-plan — CompanionBot não tinha método de
     * enquete e o publish-router pulava com poll_sem_suporte_no_bot mesmo com
     * copyPolls ligado. Sempre enquete regular: quiz exigiria o índice da
     * resposta correta, que só aparece pra quem já votou (fica escondido pra
     * quem lê via conta MTProto sem ter votado).
     */
    publishPoll(poll: SourcePoll, opts?: {
        replyToMessageId?: number;
        messageThreadId?: number;
    }): Promise<number>;
    pin(messageId: number): Promise<void>;
    /**
     * Cliente MTProto autenticado como bot, para o que a Bot API não faz.
     * Devolve também a session string, para persistir em automation_bots.
     */
    mtproto(): Promise<{
        client: MtprotoClient;
        sessionString: string;
    }>;
    disconnect(): Promise<void>;
}
/** Reexport para o cloner montar entities sem importar gramjs direto. */
export { Api };
