import { Api, type TelegramClient } from "telegram";
export type ClickButtonResult = {
    ok: true;
    message?: string;
    url?: string;
} | {
    ok: false;
    reason: "timeout";
};
/**
 * Pressiona um botão de callback do bot-alvo. `BOT_RESPONSE_TIMEOUT` (o bot
 * não respondeu no tempo do Telegram) vira um resultado normal — "sem
 * resposta, segue" — em vez de erro; qualquer outro erro (inclusive
 * FloodWaitError/SlowModeWaitError) propaga sem ser pego aqui, pro chamador
 * decidir (flood sobe pro resume existente; erro genérico vira
 * status='skipped_error' no nó).
 */
export declare function clickCallbackButton(raw: TelegramClient, peer: Api.TypeEntityLike, msgId: number, data: Buffer): Promise<ClickButtonResult>;
