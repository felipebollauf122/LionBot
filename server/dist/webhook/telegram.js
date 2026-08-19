import { supabase } from "../db.js";
import { TelegramApi } from "../telegram/api.js";
import { FlowProcessor } from "../engine/flow-processor.js";
import { LeadService } from "../services/lead-service.js";
import { TrackingService } from "../services/tracking-service.js";
import { FacebookCapi } from "../services/facebook-capi.js";
import { UtmifyService } from "../services/utmify.js";
import { addDelayedJob } from "../queue.js";
import { ensureBotPaymentKeys } from "../services/bot-loader.js";
import { buildGateway } from "../services/gateway-factory.js";
import { isBlacklisted } from "../services/blacklist.js";
import { resolveTenantIdentity } from "../services/lead-identity.js";
import { logIncoming, logEvent } from "../services/lead-messages.js";
import { config } from "../config.js";
import { botCache } from "../cache.js";
/**
 * Acha o texto do botão clicado dentro do inline keyboard que o Telegram
 * devolve no callback_query.message. Permite logar "clicou em <label>" sem
 * tocar no engine de fluxo. Retorna undefined se não achar (ex.: teclado já
 * editado) — aí logamos só o callback_data cru como fallback.
 */
function findClickedButtonLabel(cbMessage, callbackData) {
    const markup = cbMessage?.reply_markup;
    const rows = markup?.inline_keyboard;
    if (!Array.isArray(rows))
        return undefined;
    for (const row of rows) {
        for (const btn of row) {
            if (btn?.callback_data === callbackData && typeof btn.text === "string") {
                return btn.text;
            }
        }
    }
    return undefined;
}
const leadService = new LeadService(supabase);
/**
 * Sanitize and extract TID from /start payload.
 * Returns the tid string if valid, undefined otherwise.
 */
function extractTidFromPayload(text) {
    if (!text.startsWith("/start "))
        return undefined;
    const param = text.split(" ")[1]?.trim();
    if (!param)
        return undefined;
    // Accept tid_ or TID_ prefix
    if (param.startsWith("tid_") || param.startsWith("TID_")) {
        // Sanitize: only allow alphanumeric and underscore
        const sanitized = param.replace(/[^a-zA-Z0-9_]/g, "");
        return sanitized.length > 4 ? sanitized : undefined;
    }
    return undefined;
}
/**
 * Lookup tracking event by TID with retries to handle race conditions.
 * The tracking page inserts the event and immediately redirects — the /start
 * can arrive before the DB commit is visible.
 *
 * (#25) Calibrado pra cortar latência no hot path do /start: era 3 tentativas
 * com 1s de sleep cada (até 3s travando a resposta ao usuário). Agora são 3
 * tentativas com backoff curto (300ms, 500ms = 0.8s no pior caso). Pega a
 * mesma janela de race — o insert da tracking page acontece imediatamente
 * antes do redirect, então a defasagem real é de centenas de ms, não segundos.
 * A lógica black_flow/visual_flow fica idêntica (só o timing muda).
 */
async function findTrackingEvent(tid, maxRetries = 3) {
    const backoffsMs = [300, 500]; // entre tentativas 1→2 e 2→3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const { data } = await supabase
            .from("tracking_events")
            .select("*")
            .eq("tid", tid)
            .eq("event_type", "page_view")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (data) {
            console.log(`[black] TID ${tid} found in tracking_events (attempt ${attempt})`);
            return data;
        }
        if (attempt < maxRetries) {
            const waitMs = backoffsMs[attempt - 1] ?? 500;
            console.log(`[black] TID ${tid} not found yet (attempt ${attempt}/${maxRetries}), retrying in ${waitMs}ms...`);
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
    return null;
}
/**
 * Determine which flow to execute on /start:
 * - _black_flow: when black_enabled + /start + TID validated in tracking_events
 * - _visual_flow: everything else
 *
 * black_enabled sai do bot já carregado (botCache) — toggleBlackEnabled
 * invalida o cache, então o valor é confiável. Antes isso era um SELECT
 * extra em `bots` a cada /start (o 3º da mesma request, junto do lookup
 * inicial e do ensureBotPaymentKeys) só pra reler uma coluna que já estava
 * em memória.
 * Uses retry logic to handle race conditions with tracking event insertion.
 */
async function resolveFlowName(bot, messageText, telegramUserId) {
    // Extract TID from payload (if any)
    const tid = messageText.startsWith("/start") ? extractTidFromPayload(messageText) : undefined;
    const blackEnabled = bot.black_enabled ?? false;
    console.log(`[black] resolveFlowName: bot=${bot.id}, black_enabled=${blackEnabled} (cache), tid=${tid ?? "none"}, msg="${messageText.substring(0, 50)}"`);
    if (!blackEnabled) {
        let trackingData = {};
        if (tid) {
            trackingData = await resolveTrackingData(tid);
        }
        return { flowName: "_visual_flow", tid, trackingData };
    }
    // NOTA (#26): a checagem de blacklist que existia aqui foi removida —
    // era query morta. O handler (handleTelegramWebhook) já chama
    // isBlacklisted ANTES de resolveFlowName e retorna cedo (silêncio total)
    // se o user está na blacklist. Logo, quem chega aqui nunca é blacklisted.
    // BLACK FLOW DECISION
    if (!messageText.startsWith("/start")) {
        console.log(`[black] Not a /start command, using _visual_flow`);
        return { flowName: "_visual_flow", trackingData: {} };
    }
    if (!tid) {
        console.log(`[black] /start without TID payload, using _visual_flow`);
        return { flowName: "_visual_flow", trackingData: {} };
    }
    // Validate TID in tracking_events — with retries to handle race condition
    const trackingEvent = await findTrackingEvent(tid);
    if (!trackingEvent) {
        console.log(`[black] ✗ TID ${tid} NOT FOUND after all retries, falling back to _visual_flow`);
        return { flowName: "_visual_flow", tid, trackingData: {} };
    }
    // TID validated → black flow
    const utmParams = (trackingEvent.utm_params ?? {});
    const resolvedTracking = {
        fbclid: trackingEvent.fbclid ?? undefined,
        utmSource: utmParams.utm_source,
        utmMedium: utmParams.utm_medium,
        utmCampaign: utmParams.utm_campaign,
        utmContent: utmParams.utm_content,
        utmTerm: utmParams.utm_term,
    };
    console.log(`[black] ✓ TID ${tid} VALIDATED → executing _black_flow`);
    return { flowName: "_black_flow", tid, trackingData: resolvedTracking };
}
async function resolveTrackingData(tid) {
    const { data: trackingEvent } = await supabase
        .from("tracking_events")
        .select("*")
        .eq("tid", tid)
        .eq("event_type", "page_view")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!trackingEvent)
        return {};
    const utmParams = (trackingEvent.utm_params ?? {});
    return {
        fbclid: trackingEvent.fbclid ?? undefined,
        utmSource: utmParams.utm_source,
        utmMedium: utmParams.utm_medium,
        utmCampaign: utmParams.utm_campaign,
        utmContent: utmParams.utm_content,
        utmTerm: utmParams.utm_term,
    };
}
export async function handleTelegramWebhook(req, res) {
    const botId = String(req.params.botId);
    // Respond immediately to Telegram (they timeout at 60s)
    res.status(200).json({ ok: true });
    try {
        // Hot path: check cache first, then DB
        let bot = botCache.get(botId);
        if (!bot) {
            const { data } = await supabase
                .from("bots")
                .select("*")
                .eq("id", botId)
                .eq("is_active", true)
                .single();
            if (!data) {
                console.error(`Bot not found or inactive: ${botId}`);
                return;
            }
            bot = data;
            botCache.set(botId, data);
        }
        // Fork: bot de login MTProto tem máquina de estado dedicada, não passa
        // pelo flow processor / blacklist / tracking padrão.
        if (bot.is_mtproto_login_bot) {
            const { handleMtprotoLoginUpdate } = await import("./mtproto-login-handler.js");
            await handleMtprotoLoginUpdate({ id: bot.id, tenant_id: bot.tenant_id, telegram_token: bot.telegram_token }, req.body);
            return;
        }
        const typedBot = await ensureBotPaymentKeys(botId, bot);
        const telegram = new TelegramApi(typedBot.telegram_token, { protectContent: typedBot.protect_content });
        const { gateway, kind: gatewayKind } = buildGateway(typedBot);
        const processor = new FlowProcessor(supabase, leadService, { addDelayedJob }, {
            gateway,
            gatewayKind,
            baseWebhookUrl: config.baseWebhookUrl,
        });
        const update = req.body;
        // Detect SigiloPay callbacks landing on the wrong endpoint
        if (update.transactionId || update.transaction_id || update.order || (update.status && !update.message && !update.callback_query)) {
            console.warn(`[webhook] ⚠️ Payment callback landed on Telegram endpoint! Redirecting... Body:`, JSON.stringify(update));
            const { processPaymentCallback } = await import("./payment.js");
            await processPaymentCallback(botId, update);
            return;
        }
        console.log(`[webhook] Update received for bot ${botId}: type=${update.message ? 'message' : update.callback_query ? 'callback_query' : 'unknown'}`);
        // Handle message
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const telegramUserId = msg.from.id;
            const firstName = msg.from.first_name ?? "";
            const lastName = msg.from.last_name ?? null;
            const username = msg.from.username ?? null;
            const text = msg.text ?? "";
            // Blacklist: silêncio total — não responde, não cria lead, não tracka.
            if (await isBlacklisted(supabase, typedBot.id, telegramUserId)) {
                console.log(`[blacklist] Ignoring message from ${telegramUserId} on bot ${typedBot.id}`);
                return;
            }
            // Resolve which flow to use and extract tracking data
            const isStartCommand = text.startsWith("/start");
            let flowName;
            let tid;
            let trackingData = {};
            if (isStartCommand) {
                const resolved = await resolveFlowName(typedBot, text, telegramUserId);
                flowName = resolved.flowName;
                tid = resolved.tid;
                trackingData = resolved.trackingData;
                console.log(`[webhook] /start resolved: flowName=${flowName}, tid=${tid}`);
            }
            else {
                // Non-/start messages: extract tid only for tracking (no flow decision)
                tid = extractTidFromPayload(text);
                if (tid) {
                    trackingData = await resolveTrackingData(tid);
                }
            }
            // Resolve a identidade desse usuário no contexto do tenant.
            // Isso herda tid/fbclid/UTMs de outros bots do MESMO vendedor
            // (caso o user já tenha entrado em outro bot do tenant antes)
            // e atualiza com last-touch quando vem campanha nova.
            // PERF: as duas leituras são independentes — localizar o lead não
            // depende da identidade do tenant (ela só decide a ATRIBUIÇÃO, aplicada
            // logo abaixo). Rodam juntas: 1 round-trip em vez de 2 em toda mensagem.
            const [identity, existingLead] = await Promise.all([
                resolveTenantIdentity(supabase, typedBot.tenant_id, telegramUserId, typedBot.id, {
                    tid,
                    fbclid: trackingData.fbclid,
                    utm_source: trackingData.utmSource,
                    utm_medium: trackingData.utmMedium,
                    utm_campaign: trackingData.utmCampaign,
                    utm_content: trackingData.utmContent,
                    utm_term: trackingData.utmTerm,
                }),
                leadService.findLead(typedBot.id, telegramUserId),
            ]);
            // Find or create lead — passa os valores resolvidos da identidade
            // pra que o registro do lead nesse bot herde a atribuição da
            // campanha original mesmo quando o user entra direto sem ?tid=...
            const lead = await leadService.findOrCreateLead({
                botId: typedBot.id,
                tenantId: typedBot.tenant_id,
                telegramUserId,
                firstName,
                lastName,
                username,
                tid: identity.tid ?? undefined,
                fbclid: identity.fbclid ?? undefined,
                utmSource: identity.utm_source ?? undefined,
                utmMedium: identity.utm_medium ?? undefined,
                utmCampaign: identity.utm_campaign ?? undefined,
                utmContent: identity.utm_content ?? undefined,
                utmTerm: identity.utm_term ?? undefined,
            }, { existing: existingLead });
            // Timeline do chat (aba Clientes): registra o texto que o lead mandou.
            // Ignora /start (ruído de comando, não conversa). Fire-and-forget.
            if (text && !isStartCommand) {
                logIncoming({ leadId: lead.id, botId: typedBot.id, tenantId: typedBot.tenant_id }, text, msg.message_id);
            }
            // Register bot_start tracking event + Facebook CAPI Lead event
            // Fire-and-forget: don't block the flow execution on tracking
            if (tid && lead.tid === tid) {
                const facebookCapi = new FacebookCapi(typedBot.facebook_pixel_id ?? "", typedBot.facebook_access_token ?? "", {
                    pixelId: typedBot.facebook_pixel_id_backup,
                    accessToken: typedBot.facebook_access_token_backup,
                    enabled: typedBot.facebook_backup_enabled,
                });
                const utmify = new UtmifyService(typedBot.utmify_api_key ?? "");
                const trackingService = new TrackingService(supabase, facebookCapi, utmify);
                trackingService.trackLead({
                    tenantId: typedBot.tenant_id,
                    leadId: lead.id,
                    botId: typedBot.id,
                    lead: {
                        id: lead.id,
                        tid: lead.tid,
                        fbclid: lead.fbclid,
                        firstName: lead.first_name,
                        lastName: lead.last_name ?? undefined,
                        utmSource: lead.utm_source ?? undefined,
                        utmMedium: lead.utm_medium ?? undefined,
                        utmCampaign: lead.utm_campaign ?? undefined,
                        utmContent: lead.utm_content ?? undefined,
                        utmTerm: lead.utm_term ?? undefined,
                    },
                }).catch((err) => console.error("[tracking] trackLead error:", err));
            }
            // Intercepta: lead que pagou e está esperando email (capturado pelo
            // payment-webhook após confirmação do Pix). Mensagens que não sejam
            // /start são tratadas como tentativa de envio do email.
            const pendingEmailTxId = String(lead.state.pending_email_tx_id ?? "");
            if (pendingEmailTxId && !isStartCommand) {
                const { isValidEmail, completePurchase } = await import("../services/purchase-completer.js");
                if (isValidEmail(text)) {
                    const email = text.trim().toLowerCase();
                    const newState = { ...lead.state, email };
                    delete newState.pending_email_tx_id;
                    await leadService.updateState(lead.id, newState);
                    lead.state = newState;
                    const { data: tx } = await supabase
                        .from("transactions")
                        .select("*")
                        .eq("id", pendingEmailTxId)
                        .single();
                    if (tx) {
                        console.log(`[email-collector] Lead ${lead.id} sent valid email — dispatching Purchase`);
                        await completePurchase(supabase, typedBot, lead, tx);
                    }
                    return;
                }
                // Email inválido — pede de novo
                await telegram.sendMessage({
                    chatId,
                    text: "❌ <b>E-mail inválido.</b>\n\n" +
                        "Manda no formato correto, tipo <code>seunome@gmail.com</code>.\n\n" +
                        "Use um e-mail real — você vai precisar dele se tiver qualquer problema com o produto.",
                });
                return;
            }
            // On /start, route to the correct named flow
            if (isStartCommand && flowName) {
                await processor.handleStartCommand(typedBot, lead, telegram, chatId, text, flowName);
            }
            else {
                // Non-/start messages: use normal flow processing (respects active_flow_name)
                await processor.handleIncomingMessage(typedBot, lead, telegram, chatId, text);
            }
        }
        // Handle callback query (button clicks)
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message?.chat?.id;
            const telegramUserId = cb.from.id;
            const callbackData = cb.data ?? "";
            console.log(`[webhook] Callback query from ${telegramUserId}: "${callbackData}"`);
            if (!chatId)
                return;
            // Blacklist: ignora cliques de botões também.
            if (await isBlacklisted(supabase, typedBot.id, telegramUserId)) {
                console.log(`[blacklist] Ignoring callback from ${telegramUserId} on bot ${typedBot.id}`);
                try {
                    await telegram.answerCallbackQuery(cb.id);
                }
                catch { /* ignore */ }
                return;
            }
            // Herda atribuição da identity do tenant (sem update — sem campanha nova
            // num clique de botão). Paralelo com a busca do lead: independentes,
            // e este é o caminho do clique em "pagar" (geração do PIX).
            const [identity, existingLead] = await Promise.all([
                resolveTenantIdentity(supabase, typedBot.tenant_id, telegramUserId, typedBot.id, {}),
                leadService.findLead(typedBot.id, telegramUserId),
            ]);
            const lead = await leadService.findOrCreateLead({
                botId: typedBot.id,
                tenantId: typedBot.tenant_id,
                telegramUserId,
                firstName: cb.from.first_name ?? "",
                lastName: cb.from.last_name ?? null,
                username: cb.from.username ?? null,
                tid: identity.tid ?? undefined,
                fbclid: identity.fbclid ?? undefined,
                utmSource: identity.utm_source ?? undefined,
                utmMedium: identity.utm_medium ?? undefined,
                utmCampaign: identity.utm_campaign ?? undefined,
                utmContent: identity.utm_content ?? undefined,
                utmTerm: identity.utm_term ?? undefined,
            }, { existing: existingLead });
            console.log(`[webhook] Lead ${lead.id}, flow=${lead.current_flow_id}, node=${lead.current_node_id}, active_flow_name=${lead.active_flow_name}`);
            // Timeline do chat: registra "clicou em <botão>". Pega o texto do botão
            // do próprio teclado que veio no callback; fallback pro callback_data.
            {
                const label = findClickedButtonLabel(cb.message, callbackData) ?? callbackData;
                logEvent({ leadId: lead.id, botId: typedBot.id, tenantId: typedBot.tenant_id }, "button_click", label, { callback_data: callbackData });
            }
            await processor.handleCallbackQuery(typedBot, lead, telegram, chatId, callbackData);
            // Answer callback query to remove loading indicator on button
            try {
                await telegram.answerCallbackQuery(cb.id);
            }
            catch {
                // Ignore - not critical
            }
        }
    }
    catch (error) {
        console.error(`Error processing webhook for bot ${botId}:`, error);
    }
}
