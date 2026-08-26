import type { SupabaseClient } from "@supabase/supabase-js";
import { TelegramApi } from "../telegram/api.js";
import { FlowProcessor } from "../engine/flow-processor.js";
import { LeadService } from "../services/lead-service.js";
import { buildGateway } from "../services/gateway-factory.js";
import { addDelayedJob } from "../queue.js";
import { config } from "../config.js";
import type { Flow } from "../engine/flow-processor.js";
import type { Lead } from "../engine/types.js";

interface RemarketingConfig {
  id: string;
  tenant_id: string;
  bot_id: string;
  is_active: boolean;
  interval_minutes: number;
}

interface RemarketingFlow {
  id: string;
  config_id: string;
  bot_id: string;
  name: string;
  sort_order: number;
  audience: "all" | "no_purchase" | "pending_payment";
  flow_data: Flow["flow_data"];
  is_active: boolean;
  delete_after_minutes: number | null;
}

interface Bot {
  id: string;
  tenant_id: string;
  telegram_token: string;
  protect_content: boolean;
  payment_gateway: string | null;
  enabled_gateways: string[] | null;
  sigilopay_public_key: string | null;
  sigilopay_secret_key: string | null;
  evpay_api_key: string | null;
  evpay_project_id: string | null;
  zuckpay_client_id: string | null;
  zuckpay_client_secret: string | null;
  nowpayments_api_key: string | null;
  nowpayments_ipn_secret_key: string | null;
  nowpayments_pay_currency: string | null;
}

interface RemarketingProgress {
  id: string;
  lead_id: string;
  config_id: string;
  last_flow_order: number;
  last_sent_at: string | null;
  is_completed: boolean;
}

// Configs cujo processConfig() ainda está em voo de um tick anterior (ex.:
// fluxo com vários delay nodes encadeados x milhares de leads pode levar
// horas — inline sleep documentado em flow-processor.ts:494-495). Lock POR
// CONFIG, não mais um boolean global: se o config X está preso, só ELE é
// pulado no próximo tick — os configs de outros tenants (ou outros fluxos
// do mesmo tenant) continuam rodando normalmente. Isso substitui o
// `remarketingRunning` global que existia em queue.ts, que travava a
// plataforma inteira enquanto qualquer config estivesse processando.
const runningConfigIds = new Set<string>();

// Configs de tenants diferentes não têm por que ser serializados: um
// tenant com fila lenta não pode atrasar o remarketing dos demais.
// Concorrência limitada em vez de Promise.all irrestrito pra não abrir uma
// avalanche de queries simultâneas se houver muitos configs ativos.
const CONFIG_CONCURRENCY = 5;

/**
 * Process remarketing for all active configs.
 * Called on interval from queue.ts.
 */
export async function processRemarketing(db: SupabaseClient): Promise<void> {
  // Get all active remarketing configs
  const { data: configs } = await db
    .from("remarketing_configs")
    .select("*")
    .eq("is_active", true);

  if (!configs || configs.length === 0) return;

  const pending = (configs as RemarketingConfig[]).filter((cfg) => {
    if (runningConfigIds.has(cfg.id)) {
      console.log(`[remarketing] config ${cfg.id} ainda em execução (tick anterior) — pulando só este config neste tick`);
      return false;
    }
    return true;
  });

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const cfg = pending[cursor++];
      runningConfigIds.add(cfg.id);
      const startedAt = Date.now();
      try {
        await processConfig(db, cfg);
      } catch (error) {
        console.error(`[remarketing] Error processing config ${cfg.id}:`, error);
      } finally {
        runningConfigIds.delete(cfg.id);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 60_000) {
          // Ainda cabe dentro do próprio lock (o config só se auto-pula),
          // mas sinaliza que esse config específico já está comendo mais
          // que os 60s de intervalo entre ticks — candidato a fluxo com
          // delay nodes demais ou base de leads grande demais.
          console.warn(`[remarketing] config ${cfg.id} levou ${Math.round(elapsedMs / 1000)}s (> 60s de intervalo entre ticks)`);
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONFIG_CONCURRENCY, pending.length) }, () => worker()),
  );
}

async function processConfig(db: SupabaseClient, cfg: RemarketingConfig): Promise<void> {
  // Get bot
  const { data: bot } = await db
    .from("bots")
    .select("id, tenant_id, telegram_token, protect_content, payment_gateway, enabled_gateways, sigilopay_public_key, sigilopay_secret_key, evpay_api_key, evpay_project_id, zuckpay_client_id, zuckpay_client_secret, nowpayments_api_key, nowpayments_ipn_secret_key, nowpayments_pay_currency")
    .eq("id", cfg.bot_id)
    .eq("is_active", true)
    .single();

  if (!bot) return;

  const typedBot = bot as Bot;

  // Get all active remarketing flows, ordered
  const { data: flows } = await db
    .from("remarketing_flows")
    .select("*")
    .eq("config_id", cfg.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (!flows || flows.length === 0) return;

  const typedFlows = flows as RemarketingFlow[];

  // Get all leads for this bot (skip blocked ones)
  const { data: leads } = await db
    .from("leads")
    .select("*")
    .eq("bot_id", cfg.bot_id)
    .neq("blocked", true);

  if (!leads || leads.length === 0) return;

  // Tira leads que estão na blacklist do bot — eles não devem receber
  // remarketing nenhum (mesmo motivo do telegram-webhook: silêncio total).
  const { data: blacklistedRows } = await db
    .from("blacklist_users")
    .select("telegram_user_id")
    .eq("bot_id", cfg.bot_id);
  const blacklistedSet = new Set(
    (blacklistedRows ?? []).map(
      (r) => (r as { telegram_user_id: number }).telegram_user_id,
    ),
  );
  const filteredLeads = (leads as Lead[]).filter(
    (l) => !blacklistedSet.has(l.telegram_user_id),
  );
  if (filteredLeads.length === 0) return;
  if (filteredLeads.length < leads.length) {
    console.log(
      `[remarketing] bot=${cfg.bot_id}: ${leads.length - filteredLeads.length} blacklisted leads pulados`,
    );
  }

  const leadService = new LeadService(db);
  const telegram = new TelegramApi(typedBot.telegram_token, { protectContent: typedBot.protect_content });
  const { gateway, kind: gatewayKind } = buildGateway(typedBot);
  const processor = new FlowProcessor(db, leadService, { addDelayedJob }, {
    gateway,
    gatewayKind,
    baseWebhookUrl: config.baseWebhookUrl,
    botPaymentConfig: typedBot,
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
    } catch (error) {
      console.error(`[remarketing] Error for lead ${lead.id}:`, error);
    }
  }
}

interface AudienceStats {
  approved: Set<string>; // lead_ids com ao menos 1 transação approved
  pending: Set<string>; // lead_ids com ao menos 1 transação pending
}

/**
 * Carrega em 1 query quais leads têm transação approved e quais têm pending
 * pro bot. Substitui o N+1 de checkAudience (#28).
 */
async function loadAudienceStats(db: SupabaseClient, botId: string): Promise<AudienceStats> {
  const approved = new Set<string>();
  const pending = new Set<string>();
  const { data } = await db
    .from("transactions")
    .select("lead_id, status")
    .eq("bot_id", botId)
    .in("status", ["approved", "pending"]);
  for (const row of (data ?? []) as Array<{ lead_id: string; status: string }>) {
    if (row.status === "approved") approved.add(row.lead_id);
    else if (row.status === "pending") pending.add(row.lead_id);
  }
  return { approved, pending };
}

async function processLeadRemarketing(
  db: SupabaseClient,
  cfg: RemarketingConfig,
  flows: RemarketingFlow[],
  lead: Lead,
  processor: FlowProcessor,
  telegram: TelegramApi,
  now: Date,
  audienceStats: AudienceStats,
): Promise<void> {
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

    if (!created) return;
    progress = created;
  }

  const typedProgress = progress as RemarketingProgress;

  // Check interval — enough time passed since last send?
  if (typedProgress.last_sent_at) {
    const lastSent = new Date(typedProgress.last_sent_at);
    const elapsedMs = now.getTime() - lastSent.getTime();
    const intervalMs = cfg.interval_minutes * 60 * 1000;
    if (elapsedMs < intervalMs) return;
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
    if (!nextFlow) return;
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

  const flowForProcessor: Flow = {
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

  const flowResult = await processor.executeFlow(
    flowForProcessor,
    lead,
    telegram,
    lead.telegram_user_id,
    undefined,
    false,
    nextFlow.delete_after_minutes,
    false, // persistPosition=false: flow.id pertence a remarketing_flows, não a flows
  );

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
function checkAudience(
  audience: string,
  lead: Lead,
  stats: AudienceStats,
): boolean {
  if (audience === "all") return true;
  // no_purchase: lead sem nenhuma transação approved
  if (audience === "no_purchase") return !stats.approved.has(lead.id);
  // pending_payment: lead com transação pending (gerou pix, não pagou)
  if (audience === "pending_payment") return stats.pending.has(lead.id);
  return true;
}
