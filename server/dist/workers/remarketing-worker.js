import { TelegramApi } from "../telegram/api.js";
import { FlowProcessor } from "../engine/flow-processor.js";
import { LeadService } from "../services/lead-service.js";
import { buildGateway } from "../services/gateway-factory.js";
import { addDelayedJob } from "../queue.js";
import { config } from "../config.js";
/**
 * Process remarketing for all active configs.
 * Called on interval from queue.ts.
 */
export async function processRemarketing(db) {
    // Get all active remarketing configs
    const { data: configs } = await db
        .from("remarketing_configs")
        .select("*")
        .eq("is_active", true);
    if (!configs || configs.length === 0)
        return;
    for (const rawConfig of configs) {
        const cfg = rawConfig;
        try {
            await processConfig(db, cfg);
        }
        catch (error) {
            console.error(`[remarketing] Error processing config ${cfg.id}:`, error);
        }
    }
}
async function processConfig(db, cfg) {
    // Get bot
    const { data: bot } = await db
        .from("bots")
        .select("id, tenant_id, telegram_token, protect_content, sigilopay_public_key, sigilopay_secret_key")
        .eq("id", cfg.bot_id)
        .eq("is_active", true)
        .single();
    if (!bot)
        return;
    const typedBot = bot;
    // Get all active remarketing flows, ordered
    const { data: flows } = await db
        .from("remarketing_flows")
        .select("*")
        .eq("config_id", cfg.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
    if (!flows || flows.length === 0)
        return;
    const typedFlows = flows;
    // Get all leads for this bot (skip blocked ones)
    const { data: leads } = await db
        .from("leads")
        .select("*")
        .eq("bot_id", cfg.bot_id)
        .neq("blocked", true);
    if (!leads || leads.length === 0)
        return;
    // Tira leads que estão na blacklist do bot — eles não devem receber
    // remarketing nenhum (mesmo motivo do telegram-webhook: silêncio total).
    const { data: blacklistedRows } = await db
        .from("blacklist_users")
        .select("telegram_user_id")
        .eq("bot_id", cfg.bot_id);
    const blacklistedSet = new Set((blacklistedRows ?? []).map((r) => r.telegram_user_id));
    const filteredLeads = leads.filter((l) => !blacklistedSet.has(l.telegram_user_id));
    if (filteredLeads.length === 0)
        return;
    if (filteredLeads.length < leads.length) {
        console.log(`[remarketing] bot=${cfg.bot_id}: ${leads.length - filteredLeads.length} blacklisted leads pulados`);
    }
    const leadService = new LeadService(db);
    const telegram = new TelegramApi(typedBot.telegram_token, { protectContent: typedBot.protect_content });
    const { gateway, kind: gatewayKind } = buildGateway(typedBot);
    const processor = new FlowProcessor(db, leadService, { addDelayedJob }, {
        gateway,
        gatewayKind,
        baseWebhookUrl: config.baseWebhookUrl,
    });
    const now = new Date();
    // Pré-carrega contadores de transação por lead numa única query (#28).
    // Antes: checkAudience fazia 1 COUNT por lead por ciclo (N+1). Agora
    // 1 query traz approved/pending de todos os leads do bot, e checkAudience
    // consulta o Map em memória.
    const audienceStats = await loadAudienceStats(db, cfg.bot_id);
    for (const lead of filteredLeads) {
        try {
            await processLeadRemarketing(db, cfg, typedFlows, lead, processor, telegram, now, audienceStats);
        }
        catch (error) {
            console.error(`[remarketing] Error for lead ${lead.id}:`, error);
        }
    }
}
/**
 * Carrega em 1 query quais leads têm transação approved e quais têm pending
 * pro bot. Substitui o N+1 de checkAudience (#28).
 */
async function loadAudienceStats(db, botId) {
    const approved = new Set();
    const pending = new Set();
    const { data } = await db
        .from("transactions")
        .select("lead_id, status")
        .eq("bot_id", botId)
        .in("status", ["approved", "pending"]);
    for (const row of (data ?? [])) {
        if (row.status === "approved")
            approved.add(row.lead_id);
        else if (row.status === "pending")
            pending.add(row.lead_id);
    }
    return { approved, pending };
}
async function processLeadRemarketing(db, cfg, flows, lead, processor, telegram, now, audienceStats) {
    // Get or create progress for this lead
    let { data: progress } = await db
        .from("remarketing_progress")
        .select("*")
        .eq("config_id", cfg.id)
        .eq("lead_id", lead.id)
        .maybeSingle();
    if (!progress) {
        const { data: created } = await db
            .from("remarketing_progress")
            .insert({
            bot_id: cfg.bot_id,
            lead_id: lead.id,
            config_id: cfg.id,
            last_flow_order: -1,
            last_sent_at: null,
            is_completed: false,
        })
            .select("*")
            .single();
        if (!created)
            return;
        progress = created;
    }
    const typedProgress = progress;
    // Check interval — enough time passed since last send?
    if (typedProgress.last_sent_at) {
        const lastSent = new Date(typedProgress.last_sent_at);
        const elapsedMs = now.getTime() - lastSent.getTime();
        const intervalMs = cfg.interval_minutes * 60 * 1000;
        if (elapsedMs < intervalMs)
            return;
    }
    // Find next flow in sequence
    let nextFlow = flows.find((f) => f.sort_order > typedProgress.last_flow_order);
    if (!nextFlow) {
        // All flows sent — loop back to the first flow
        await db
            .from("remarketing_progress")
            .update({ last_flow_order: -1, is_completed: false })
            .eq("id", typedProgress.id);
        nextFlow = flows.find((f) => f.sort_order > -1);
        if (!nextFlow)
            return;
    }
    // Check audience filter (usa stats pré-carregados, sem query por lead — #28)
    const shouldSend = checkAudience(nextFlow.audience, lead, audienceStats);
    if (!shouldSend) {
        // Skip this flow, advance to the next one
        await db
            .from("remarketing_progress")
            .update({
            last_flow_order: nextFlow.sort_order,
            last_sent_at: now.toISOString(),
        })
            .eq("id", typedProgress.id);
        return;
    }
    // Trava de DB: tenta avançar last_flow_order ANTES de mandar a mensagem,
    // condicionado ao last_sent_at e last_flow_order continuarem como
    // estavam quando a gente leu. Se algum outro tick já avançou (race
    // condition), o update afeta 0 linhas e a gente desiste — evita
    // duplicação de mensagens no remarketing.
    let lockUpdate = db
        .from("remarketing_progress")
        .update({
        last_flow_order: nextFlow.sort_order,
        last_sent_at: now.toISOString(),
    })
        .eq("id", typedProgress.id)
        .eq("last_flow_order", typedProgress.last_flow_order);
    lockUpdate = typedProgress.last_sent_at
        ? lockUpdate.eq("last_sent_at", typedProgress.last_sent_at)
        : lockUpdate.is("last_sent_at", null);
    const { data: lockedRows } = await lockUpdate.select("id");
    if (!lockedRows || lockedRows.length === 0) {
        console.log(`[remarketing] Lock race lost for lead ${lead.id}, flow "${nextFlow.name}" — skipping`);
        return;
    }
    // Execute the remarketing flow
    console.log(`[remarketing] Sending flow "${nextFlow.name}" to lead ${lead.id}`);
    const flowForProcessor = {
        id: nextFlow.id,
        tenant_id: cfg.tenant_id,
        bot_id: cfg.bot_id,
        name: nextFlow.name,
        trigger_type: "remarketing",
        trigger_value: "",
        flow_data: nextFlow.flow_data,
        is_active: true,
        version: 1,
        created_at: "",
        updated_at: "",
    };
    const flowResult = await processor.executeFlow(flowForProcessor, lead, telegram, lead.telegram_user_id, undefined, false, nextFlow.delete_after_minutes, false);
    // If user blocked the bot, mark lead so we skip them in future remarketing.
    // Progress já foi avançado antes do envio (lock acima), então mesmo que
    // bloqueado o lead não é tentado de novo nesse mesmo flow.
    if (flowResult.blocked) {
        console.log(`[remarketing] Lead ${lead.id} blocked the bot, marking as blocked`);
        await db.from("leads").update({ blocked: true }).eq("id", lead.id);
    }
}
/**
 * Check if a lead matches the audience filter for a remarketing flow.
 * Usa stats pré-carregados em memória (sem query por lead — #28).
 */
function checkAudience(audience, lead, stats) {
    if (audience === "all")
        return true;
    // no_purchase: lead sem nenhuma transação approved
    if (audience === "no_purchase")
        return !stats.approved.has(lead.id);
    // pending_payment: lead com transação pending (gerou pix, não pagou)
    if (audience === "pending_payment")
        return stats.pending.has(lead.id);
    return true;
}
