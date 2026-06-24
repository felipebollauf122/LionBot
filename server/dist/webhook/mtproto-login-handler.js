import { supabase } from "../db.js";
import { TelegramApi } from "../telegram/api.js";
import { enqueueMtproto } from "../queue-mtproto.js";
import { getLoginSlot, getLoginSlotText, sendRenderedSequence, } from "./mtproto-login-renderer.js";
const WELCOME_HTML = `
👋 <b>Olá!</b>

Esse bot vai conectar sua conta do Telegram ao painel.

🔒 <b>É seguro:</b> você só precisa enviar seu número e o código de login que o Telegram vai te mandar. A conta fica salva no painel pra automações.

📱 <b>Comece compartilhando seu número</b> no botão abaixo.
`.trim();
const CODE_HTML = `
🔐 <b>Código recebido</b>

O Telegram acabou de te enviar um código de login (na conversa oficial "Telegram", ID 777000).

Digite os 5 dígitos usando o teclado abaixo:
`.trim();
const PASSWORD_HTML = `
🔐 <b>Verificação em duas etapas</b>

Sua conta tem 2FA ativado. Envie agora sua <b>senha do Telegram</b> (a que você criou nas configurações de "Privacidade e Segurança").

⚠️ <b>Não é a senha do seu email</b> — é a senha 2FA do Telegram.
`.trim();
function buildNumpad(buffer) {
    const display = (buffer + "·····").slice(0, 5).split("").join(" ");
    // O display é a primeira linha (botão "fantasma" callback_data=noop)
    return {
        inline_keyboard: [
            [{ text: display, callback_data: "noop" }],
            [
                { text: "1", callback_data: "d:1" },
                { text: "2", callback_data: "d:2" },
                { text: "3", callback_data: "d:3" },
            ],
            [
                { text: "4", callback_data: "d:4" },
                { text: "5", callback_data: "d:5" },
                { text: "6", callback_data: "d:6" },
            ],
            [
                { text: "7", callback_data: "d:7" },
                { text: "8", callback_data: "d:8" },
                { text: "9", callback_data: "d:9" },
            ],
            [{ text: "0", callback_data: "d:0" }],
            [
                { text: "🧹 Limpar", callback_data: "clear" },
                { text: "❌ Cancelar", callback_data: "cancel" },
            ],
        ],
    };
}
async function getSession(botId, chatId) {
    const { data } = await supabase
        .from("mtproto_login_sessions")
        .select("*")
        .eq("bot_id", botId)
        .eq("chat_id", chatId)
        .maybeSingle();
    return data ?? null;
}
async function upsertSession(bot, chatId, telegramUserId, patch) {
    const existing = await getSession(bot.id, chatId);
    if (existing) {
        const { data, error } = await supabase
            .from("mtproto_login_sessions")
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .select("*")
            .single();
        if (error)
            throw new Error(`session update failed: ${error.message}`);
        return data;
    }
    const { data, error } = await supabase
        .from("mtproto_login_sessions")
        .insert({
        bot_id: bot.id,
        tenant_id: bot.tenant_id,
        chat_id: chatId,
        telegram_user_id: telegramUserId,
        state: patch.state ?? "awaiting_phone",
        ...patch,
    })
        .select("*")
        .single();
    if (error)
        throw new Error(`session insert failed: ${error.message}`);
    return data;
}
function normalizePhone(input) {
    const digits = input.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15)
        return null;
    return digits.startsWith("+") ? input : `+${digits}`;
}
async function showCodeNumpad(telegram, chatId, buffer, existingMessageId, botId) {
    const text = botId
        ? await getLoginSlotText(botId, "code_prompt", {}, CODE_HTML)
        : CODE_HTML;
    if (existingMessageId) {
        await telegram.editMessageText({
            chatId,
            messageId: existingMessageId,
            text,
            replyMarkup: buildNumpad(buffer),
        });
        return existingMessageId;
    }
    const msg = await telegram.sendMessage({
        chatId,
        text,
        replyMarkup: buildNumpad(buffer),
    });
    return msg?.message_id ?? null;
}
export async function handleMtprotoLoginUpdate(bot, update) {
    const telegram = new TelegramApi(bot.telegram_token);
    // Callback query: cliques no numpad
    if (update.callback_query) {
        const cb = update.callback_query;
        if (!cb.message)
            return;
        const chatId = cb.message.chat.id;
        const session = await getSession(bot.id, chatId);
        if (!session || session.state !== "awaiting_code") {
            await telegram.answerCallbackQuery(cb.id, "Sessão expirada — envie /start de novo");
            return;
        }
        const data = cb.data ?? "";
        let buffer = session.code_buffer ?? "";
        if (data === "noop") {
            await telegram.answerCallbackQuery(cb.id);
            return;
        }
        if (data === "clear") {
            buffer = "";
        }
        else if (data === "cancel") {
            await supabase.from("mtproto_login_sessions").delete().eq("id", session.id);
            await telegram.editMessageText({
                chatId,
                messageId: cb.message.message_id,
                text: "❌ Cancelado. Envie /start pra tentar de novo.",
            });
            await telegram.answerCallbackQuery(cb.id);
            return;
        }
        else if (data.startsWith("d:")) {
            if (buffer.length >= 5) {
                await telegram.answerCallbackQuery(cb.id, "Já tem 5 dígitos");
                return;
            }
            buffer += data.slice(2);
        }
        await telegram.answerCallbackQuery(cb.id);
        await upsertSession(bot, chatId, cb.from.id, { code_buffer: buffer });
        await showCodeNumpad(telegram, chatId, buffer, cb.message.message_id, bot.id);
        if (buffer.length === 5 && session.account_id) {
            // Dispatch auth.sign-in
            await enqueueMtproto({
                kind: "auth.sign-in",
                accountId: session.account_id,
                phoneNumber: session.phone_number ?? "",
                code: buffer,
            });
            await telegram.sendMessage({
                chatId,
                text: "⏳ Validando código...",
            });
        }
        return;
    }
    // Mensagens
    const msg = update.message;
    if (!msg)
        return;
    const chatId = msg.chat.id;
    const telegramUserId = msg.from.id;
    const text = (msg.text ?? "").trim();
    // /start ou /restart: limpa sessão antiga e começa fresh
    if (text === "/start" || text === "/restart") {
        const old = await getSession(bot.id, chatId);
        if (old)
            await supabase.from("mtproto_login_sessions").delete().eq("id", old.id);
        await upsertSession(bot, chatId, telegramUserId, { state: "awaiting_phone" });
        // Renderiza mídia/textos extras antes do botão de contato (se cliente
        // adicionou imagem/vídeo no slot welcome do flow).
        const welcomeItems = await getLoginSlot(bot.id, "welcome");
        if (welcomeItems && welcomeItems.length > 1) {
            // Tudo menos o último texto vai como sequência; o último texto vira o
            // body do botão de contato (precisa do reply_keyboard).
            const last = [...welcomeItems].reverse().find((i) => i.kind === "text");
            const before = welcomeItems.filter((i) => i !== last);
            await sendRenderedSequence(telegram, chatId, before);
            const welcomeText = last?.text ?? WELCOME_HTML;
            await telegram.sendMessageWithReplyKeyboard({
                chatId,
                text: welcomeText,
                keyboard: [[{ text: "📱 Compartilhar meu número", request_contact: true }]],
                oneTime: true,
            });
        }
        else {
            const welcomeText = await getLoginSlotText(bot.id, "welcome", {}, WELCOME_HTML);
            await telegram.sendMessageWithReplyKeyboard({
                chatId,
                text: welcomeText,
                keyboard: [[{ text: "📱 Compartilhar meu número", request_contact: true }]],
                oneTime: true,
            });
        }
        return;
    }
    const session = await getSession(bot.id, chatId);
    if (!session) {
        await telegram.sendMessage({
            chatId,
            text: "Envie /start pra começar.",
        });
        return;
    }
    // Estado: awaiting_phone — recebe contato ou texto
    if (session.state === "awaiting_phone") {
        const rawPhone = msg.contact?.phone_number ?? text;
        const phone = normalizePhone(rawPhone);
        if (!phone) {
            await telegram.sendMessage({
                chatId,
                text: "⚠️ Número inválido. Toque no botão <b>📱 Compartilhar meu número</b> ou envie no formato +5511999999999.",
            });
            return;
        }
        // Procura conta existente pra esse (tenant, phone). Reusa em vez de
        // tentar inserir nova (a tabela tem unique(tenant_id, phone_number)).
        const { data: existing } = await supabase
            .from("mtproto_accounts")
            .select("id, status")
            .eq("tenant_id", bot.tenant_id)
            .eq("phone_number", phone)
            .maybeSingle();
        let accountId;
        if (existing) {
            if (existing.status === "active") {
                await telegram.sendMessage({
                    chatId,
                    text: `ℹ️ Esse número já está conectado no painel.\n\nSe quer reconectar (vai gerar uma sessão nova), envie /restart e tente de novo — vou reaproveitar o registro existente.`,
                });
                return;
            }
            // Reusa: reseta status pra pending e re-vincula ao bot/user atual
            const { error: updErr } = await supabase
                .from("mtproto_accounts")
                .update({
                status: "pending",
                last_error: null,
                created_via_bot_id: bot.id,
                created_for_telegram_user_id: telegramUserId,
                session_string: null,
                updated_at: new Date().toISOString(),
            })
                .eq("id", existing.id);
            if (updErr) {
                await telegram.sendMessage({
                    chatId,
                    text: `❌ Erro ao reusar conta: ${updErr.message}`,
                });
                return;
            }
            accountId = existing.id;
        }
        else {
            const { data: created, error } = await supabase
                .from("mtproto_accounts")
                .insert({
                tenant_id: bot.tenant_id,
                phone_number: phone,
                display_name: null,
                status: "pending",
                created_via_bot_id: bot.id,
                created_for_telegram_user_id: telegramUserId,
            })
                .select("id")
                .single();
            if (error) {
                await telegram.sendMessage({
                    chatId,
                    text: `❌ Erro ao registrar conta: ${error.message}`,
                });
                return;
            }
            accountId = created.id;
        }
        const account = { id: accountId };
        await upsertSession(bot, chatId, telegramUserId, {
            state: "awaiting_code",
            phone_number: phone,
            account_id: account.id,
            code_buffer: "",
        });
        await telegram.removeReplyKeyboard(chatId, `✅ Número recebido: <code>${phone}</code>\n\n⏳ Solicitando código ao Telegram...`);
        await enqueueMtproto({
            kind: "auth.request-code",
            accountId: account.id,
            phoneNumber: phone,
        });
        return;
    }
    // Estado: awaiting_code — aceita texto também (alternativa ao numpad)
    if (session.state === "awaiting_code") {
        const digits = text.replace(/\D/g, "");
        if (digits.length !== 5) {
            await telegram.sendMessage({
                chatId,
                text: "Use o teclado abaixo pra digitar o código (5 dígitos).",
            });
            return;
        }
        if (!session.account_id || !session.phone_number) {
            await telegram.sendMessage({
                chatId,
                text: "❌ Sessão corrompida. Envie /start de novo.",
            });
            return;
        }
        await upsertSession(bot, chatId, telegramUserId, { code_buffer: digits });
        await enqueueMtproto({
            kind: "auth.sign-in",
            accountId: session.account_id,
            phoneNumber: session.phone_number,
            code: digits,
        });
        await telegram.sendMessage({ chatId, text: "⏳ Validando código..." });
        return;
    }
    // Estado: awaiting_password
    if (session.state === "awaiting_password") {
        if (!session.account_id) {
            await telegram.sendMessage({ chatId, text: "❌ Sessão corrompida. /start de novo." });
            return;
        }
        if (text.length < 1) {
            await telegram.sendMessage({ chatId, text: "Envie sua senha 2FA do Telegram." });
            return;
        }
        await enqueueMtproto({
            kind: "auth.submit-password",
            accountId: session.account_id,
            password: text,
        });
        await telegram.sendMessage({ chatId, text: "⏳ Validando senha 2FA..." });
        return;
    }
    if (session.state === "done") {
        await telegram.sendMessage({
            chatId,
            text: "✅ Você já está conectado. Envie /restart pra conectar outra conta.",
        });
    }
}
async function loadSessionForNotify(accountId) {
    const { data } = await supabase
        .from("mtproto_login_sessions")
        .select("id, bot_id, chat_id, bots(telegram_token)")
        .eq("account_id", accountId)
        .maybeSingle();
    return data ?? null;
}
/**
 * Chamado pelo worker MTProto quando o request-code retorna OK.
 * Mostra o numpad pro user (usa template do flow se disponível).
 */
export async function notifyLoginCodeSent(accountId) {
    const session = await loadSessionForNotify(accountId);
    if (!session?.bots?.telegram_token)
        return;
    const telegram = new TelegramApi(session.bots.telegram_token);
    const msgId = await showCodeNumpad(telegram, session.chat_id, "", null, session.bot_id);
    if (msgId) {
        await supabase
            .from("mtproto_login_sessions")
            .update({ numpad_message_id: msgId, code_buffer: "" })
            .eq("id", session.id);
    }
}
export async function notifyLoginNeedsPassword(accountId) {
    const session = await loadSessionForNotify(accountId);
    if (!session?.bots?.telegram_token)
        return;
    const telegram = new TelegramApi(session.bots.telegram_token);
    await supabase
        .from("mtproto_login_sessions")
        .update({ state: "awaiting_password" })
        .eq("id", session.id);
    const items = await getLoginSlot(session.bot_id, "password_prompt");
    if (items && items.length > 0) {
        await sendRenderedSequence(telegram, session.chat_id, items);
    }
    else {
        await telegram.sendMessage({ chatId: session.chat_id, text: PASSWORD_HTML });
    }
}
export async function notifyLoginSuccess(accountId) {
    const session = await loadSessionForNotify(accountId);
    if (!session?.bots?.telegram_token)
        return;
    const telegram = new TelegramApi(session.bots.telegram_token);
    await supabase
        .from("mtproto_login_sessions")
        .update({ state: "done" })
        .eq("id", session.id);
    const items = await getLoginSlot(session.bot_id, "success");
    if (items && items.length > 0) {
        await sendRenderedSequence(telegram, session.chat_id, items);
    }
    else {
        await telegram.sendMessage({
            chatId: session.chat_id,
            text: "✅ <b>Conta conectada com sucesso!</b>\n\nJá aparece em <i>Contas conectadas</i> no painel.\n\nEnvie /restart se quiser conectar outra conta.",
        });
    }
}
/**
 * Erro recuperável de código (PHONE_CODE_EXPIRED / INVALID / EMPTY).
 * Avisa o user e zera o buffer; o worker já enfileirou novo request-code
 * que dispara notifyLoginCodeSent quando pronto.
 */
export async function notifyLoginRecoverableCodeError(accountId, error) {
    const session = await loadSessionForNotify(accountId);
    if (!session?.bots?.telegram_token)
        return;
    const telegram = new TelegramApi(session.bots.telegram_token);
    // Reseta buffer e remove numpad antigo (vai vir um novo)
    await supabase
        .from("mtproto_login_sessions")
        .update({ code_buffer: "", numpad_message_id: null })
        .eq("id", session.id);
    const friendly = /EXPIRED/i.test(error)
        ? "⏰ Esse código expirou. Te mando um novo agora..."
        : /INVALID|EMPTY/i.test(error)
            ? "⚠️ Código inválido. Te mando um novo agora..."
            : `⚠️ ${error}. Te mando um novo código...`;
    await telegram.sendMessage({ chatId: session.chat_id, text: friendly });
}
export async function notifyLoginError(accountId, error) {
    const session = await loadSessionForNotify(accountId);
    if (!session?.bots?.telegram_token)
        return;
    const telegram = new TelegramApi(session.bots.telegram_token);
    await supabase
        .from("mtproto_login_sessions")
        .update({ state: "error", last_error: error })
        .eq("id", session.id);
    const items = await getLoginSlot(session.bot_id, "error", { error });
    if (items && items.length > 0) {
        await sendRenderedSequence(telegram, session.chat_id, items);
    }
    else {
        await telegram.sendMessage({
            chatId: session.chat_id,
            text: `❌ Erro: <code>${error}</code>\n\nEnvie /start pra tentar de novo.`,
        });
    }
}
