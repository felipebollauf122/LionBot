import { Api } from "telegram";
import { Bot, InputFile } from "grammy";
import { MtprotoClient } from "../client.js";
import { toBotApiEntities } from "./entities.js";
export const defaultBotValidationDeps = {
    getMe: async (token) => {
        const me = await new Bot(token).api.getMe();
        return { id: me.id, username: me.username, is_bot: me.is_bot };
    },
};
/**
 * Valida o token colado pelo owner. Username é obrigatório porque a promoção
 * a admin resolve o bot por @username (contacts.ResolveUsername).
 */
export async function validateBotToken(token, deps = defaultBotValidationDeps) {
    if (!token || !token.trim())
        return { ok: false, error: "token_vazio" };
    try {
        const me = await deps.getMe(token.trim());
        if (!me.is_bot)
            return { ok: false, error: "nao_e_bot" };
        if (!me.username)
            return { ok: false, error: "bot_sem_username" };
        return { ok: true, botUserId: String(me.id), username: me.username };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
/**
 * Só botões de URL sobrevivem à clonagem: callback pertence ao bot que criou
 * a mensagem original e não funciona fora dele.
 */
export function buildInlineKeyboard(links) {
    return {
        inline_keyboard: links
            .filter((l) => /^https?:\/\//i.test(l.url))
            .map((l) => [{ text: l.label, url: l.url }]),
    };
}
/**
 * Publicador do clone. Bot API para o caso comum; cliente MTProto de bot
 * apenas para o que a Bot API não cobre.
 */
export class CompanionBot {
    token;
    destChatId;
    sessionString;
    creds;
    bot;
    mt = null;
    constructor(token, 
    /** chat_id no formato do Bot API: -100<channelId> para canal/supergrupo. */
    destChatId, sessionString = null, 
    /**
     * Credenciais MTProto do app. Injetadas em vez de importadas de config.ts
     * porque aquele modulo dispara assert de env no import, o que prendia os
     * testes puros deste arquivo a ter SUPABASE_URL no ambiente.
     */
    creds = null) {
        this.token = token;
        this.destChatId = destChatId;
        this.sessionString = sessionString;
        this.creds = creds;
        this.bot = new Bot(token);
    }
    static destChatIdFromChannelId(channelId) {
        return `-100${channelId}`;
    }
    async publishText(text, opts = {}) {
        const sent = await this.bot.api.sendMessage(this.destChatId, text, {
            entities: toBotApiEntities(opts.entities),
            link_preview_options: { is_disabled: false },
            reply_parameters: opts.replyToMessageId
                ? { message_id: opts.replyToMessageId }
                : undefined,
            reply_markup: opts.inlineLinks?.length
                ? buildInlineKeyboard(opts.inlineLinks)
                : undefined,
            disable_notification: true,
            message_thread_id: opts.messageThreadId,
        });
        return sent.message_id;
    }
    async publishMedia(filePath, kind, caption, opts = {}) {
        // Nome original (aula-03.pdf) em vez de msg_<id> sem extensão (defeito
        // I2): sem 2º argumento, InputFile chuta o nome a partir do path no
        // disco (o basename de um arquivo temporário sem extensão).
        const file = new InputFile(filePath, opts.fileName);
        const common = {
            caption: caption || undefined,
            caption_entities: toBotApiEntities(opts.entities),
            reply_parameters: opts.replyToMessageId
                ? { message_id: opts.replyToMessageId }
                : undefined,
            reply_markup: opts.inlineLinks?.length
                ? buildInlineKeyboard(opts.inlineLinks)
                : undefined,
            disable_notification: true,
            message_thread_id: opts.messageThreadId,
        };
        const api = this.bot.api;
        const sent = kind === "photo"
            ? await api.sendPhoto(this.destChatId, file, common)
            : kind === "video"
                ? await api.sendVideo(this.destChatId, file, common)
                : kind === "audio"
                    ? await api.sendAudio(this.destChatId, file, common)
                    : kind === "animation"
                        ? await api.sendAnimation(this.destChatId, file, common)
                        : kind === "sticker"
                            ? await api.sendSticker(this.destChatId, file, {
                                reply_parameters: common.reply_parameters,
                                disable_notification: true,
                                message_thread_id: common.message_thread_id,
                            })
                            : await api.sendDocument(this.destChatId, file, common);
        return sent.message_id;
    }
    /** Álbum. O caller já fatiou em no máximo 10 itens. */
    async publishAlbum(items, 
    /**
     * Opcional, sem default de reply: o Telegram ancora o reply no primeiro
     * item do álbum automaticamente, então o caller só precisa passar o id.
     */
    opts = {}) {
        const media = items.map((it) => ({
            type: it.kind,
            media: new InputFile(it.filePath),
            caption: it.caption || undefined,
            caption_entities: toBotApiEntities(it.entities),
        }));
        const sent = await this.bot.api.sendMediaGroup(this.destChatId, media, {
            disable_notification: true,
            reply_parameters: opts.replyToMessageId
                ? { message_id: opts.replyToMessageId }
                : undefined,
            message_thread_id: opts.messageThreadId,
        });
        return sent.map((m) => m.message_id);
    }
    /**
     * Recria a enquete (defeito I7): a rota download não tinha como reproduzir
     * `{kind:"poll"}` do media-plan — CompanionBot não tinha método de
     * enquete e o publish-router pulava com poll_sem_suporte_no_bot mesmo com
     * copyPolls ligado. Sempre enquete regular: quiz exigiria o índice da
     * resposta correta, que só aparece pra quem já votou (fica escondido pra
     * quem lê via conta MTProto sem ter votado).
     */
    async publishPoll(poll, opts = {}) {
        const sent = await this.bot.api.sendPoll(this.destChatId, poll.question, poll.options.map((text) => ({ text })), {
            is_anonymous: poll.isAnonymous,
            allows_multiple_answers: poll.allowsMultipleAnswers,
            disable_notification: true,
            reply_parameters: opts.replyToMessageId
                ? { message_id: opts.replyToMessageId }
                : undefined,
            message_thread_id: opts.messageThreadId,
        });
        return sent.message_id;
    }
    async pin(messageId) {
        await this.bot.api.pinChatMessage(this.destChatId, messageId, {
            disable_notification: true,
        });
    }
    /**
     * Cliente MTProto autenticado como bot, para o que a Bot API não faz.
     * Devolve também a session string, para persistir em automation_bots.
     */
    async mtproto() {
        if (!this.mt) {
            if (!this.creds) {
                throw new Error("CompanionBot.mtproto() precisa de creds (apiId/apiHash) injetadas no construtor");
            }
            this.mt = new MtprotoClient(this.creds.apiId, this.creds.apiHash, this.sessionString ?? "");
            if (!this.sessionString) {
                this.sessionString = await this.mt.signInAsBot(this.token);
            }
            else {
                await this.mt.connect();
            }
        }
        return { client: this.mt, sessionString: this.sessionString };
    }
    async disconnect() {
        await this.mt?.disconnect().catch(() => { });
        this.mt = null;
    }
}
/** Reexport para o cloner montar entities sem importar gramjs direto. */
export { Api };
