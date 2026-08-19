import { Api } from "telegram";
/**
 * Pressiona um botão de callback do bot-alvo. `BOT_RESPONSE_TIMEOUT` (o bot
 * não respondeu no tempo do Telegram) vira um resultado normal — "sem
 * resposta, segue" — em vez de erro; qualquer outro erro (inclusive
 * FloodWaitError/SlowModeWaitError) propaga sem ser pego aqui, pro chamador
 * decidir (flood sobe pro resume existente; erro genérico vira
 * status='skipped_error' no nó).
 */
export async function clickCallbackButton(raw, peer, msgId, data) {
    try {
        const result = await raw.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId, data }));
        return { ok: true, message: result.message, url: result.url };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/BOT_RESPONSE_TIMEOUT/i.test(msg))
            return { ok: false, reason: "timeout" };
        throw err;
    }
}
