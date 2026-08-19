export interface SendMessageParams {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
}
export interface SendPhotoParams {
    chatId: number;
    photo: string;
    caption?: string;
    replyMarkup?: InlineKeyboardMarkup;
}
export interface SendVideoParams {
    chatId: number;
    video: string;
    caption?: string;
    replyMarkup?: InlineKeyboardMarkup;
}
export type InlineKeyboardButtonStyle = "danger" | "success" | "primary";
export interface InlineKeyboardButton {
    text: string;
    url?: string;
    callback_data?: string;
    copy_text?: {
        text: string;
    };
    /**
     * Cor do botão (Bot API 8.x+).
     *   danger  → vermelho
     *   success → verde
     *   primary → azul
     * Omitido = cor padrão do tema do cliente.
     */
    style?: InlineKeyboardButtonStyle;
}
export interface InlineKeyboardMarkup {
    inline_keyboard: InlineKeyboardButton[][];
}
export interface TelegramMessage {
    message_id: number;
    chat: {
        id: number;
    };
}
export declare class TelegramApi {
    private token;
    private baseUrl;
    private protectContent;
    constructor(token: string, options?: {
        protectContent?: boolean;
    });
    get botToken(): string;
    sendMessage(params: SendMessageParams): Promise<TelegramMessage | null>;
    sendPhoto(params: SendPhotoParams): Promise<TelegramMessage | null>;
    sendVideo(params: SendVideoParams): Promise<TelegramMessage | null>;
    private sendVideoAsUpload;
    deleteMessage(chatId: number, messageId: number): Promise<boolean>;
    setWebhook(url: string): Promise<void>;
    editMessageText(params: {
        chatId: number;
        messageId: number;
        text: string;
        replyMarkup?: InlineKeyboardMarkup;
    }): Promise<void>;
    sendMessageWithReplyKeyboard(params: {
        chatId: number;
        text: string;
        keyboard: Array<Array<{
            text: string;
            request_contact?: boolean;
        }>>;
        oneTime?: boolean;
    }): Promise<TelegramMessage | null>;
    removeReplyKeyboard(chatId: number, text: string): Promise<TelegramMessage | null>;
    answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
    deleteWebhook(): Promise<void>;
    private request;
    private requestMultipart;
}
