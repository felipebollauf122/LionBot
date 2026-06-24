import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { supabase } from "./db.js";
import { TelegramApi } from "./telegram/api.js";
import { FlowProcessor } from "./engine/flow-processor.js";
import { LeadService } from "./services/lead-service.js";
import { ensureBotPaymentKeys } from "./services/bot-loader.js";
import { buildGateway } from "./services/gateway-factory.js";
import { botCache, flowByIdCache } from "./cache.js";

import type { Flow } from "./engine/flow-processor.js";
import { processRemarketing } from "./workers/remarketing-worker.js";
import { pollEvpayPendingTransactions } from "./workers/evpay-poller.js";
import { pollPoseidonPendingTransactions } from "./workers/poseidonpay-poller.js";
import { pollChannelMonitors } from "./workers/channel-monitor-poller.js";

interface Bot {
  id: string;
  tenant_id: string;
  telegram_token: string;
  protect_content: boolean;
  payment_gateway: string | null;
  sigilopay_public_key: string | null;
  sigilopay_secret_key: string | null;
  evpay_api_key: string | null;
  evpay_project_id: string | null;
  facebook_pixel_id: string | null;
  facebook_access_token: string | null;
  facebook_pixel_id_backup: string | null;
  facebook_access_token_backup: string | null;
  facebook_backup_enabled: boolean | null;
  utmify_api_key: string | null;
}

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

interface DelayedJobData {
  leadId: string;
  flowId: string;
  nodeId: string;
  botId: string;
  tenantId: string;
  chatId: number;
}

export const delayedQueue = new Queue<DelayedJobData>("delayed-messages", {
  connection,
});

export async function addDelayedJob(data: DelayedJobData, delaySeconds: number): Promise<void> {
  await delayedQueue.add("resume-flow", data, {
    delay: delaySeconds * 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });
}

// Payment timeout: fires "not_paid" edge if payment wasn't confirmed in time
interface PaymentTimeoutData {
  leadId: string;
  flowId: string;
  paymentNodeId: string;
  externalTransactionId: string;
  botId: string;
  tenantId: string;
  chatId: number;
}

export const paymentTimeoutQueue = new Queue<PaymentTimeoutData>("payment-timeout", {
  connection,
});

export async function addPaymentTimeoutJob(data: PaymentTimeoutData, delaySeconds: number): Promise<void> {
  await paymentTimeoutQueue.add("check-payment", data, {
    delay: delaySeconds * 1000,
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
  });
}

// Purchase email timeout: dispara Purchase mesmo sem email após X segundos
interface PurchaseEmailTimeoutData {
  leadId: string;
  transactionId: string;
}

export const purchaseEmailTimeoutQueue = new Queue<PurchaseEmailTimeoutData>("purchase-email-timeout", {
  connection,
});

export async function addPurchaseEmailTimeoutJob(
  data: PurchaseEmailTimeoutData,
  delaySeconds: number,
): Promise<void> {
  await purchaseEmailTimeoutQueue.add("flush-purchase", data, {
    delay: delaySeconds * 1000,
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
  });
}

/**
 * Process pending message deletions from the message_delete_queue.
 * Called on interval — picks up messages where delete_at has passed.
 */
async function processMessageDeletions(): Promise<void> {
  const now = new Date().toISOString();

  const { data: messages, error } = await supabase
    .from("message_delete_queue")
    .select("*")
    .eq("status", "pending")
    .lte("delete_at", now)
    .limit(50);

  if (error || !messages || messages.length === 0) return;

  console.log(`[black-delete] Processing ${messages.length} pending deletions`);

  for (const msg of messages) {
    const telegram = new TelegramApi(msg.bot_token);
    const success = await telegram.deleteMessage(msg.chat_id, msg.message_id);

    if (success) {
      await supabase
        .from("message_delete_queue")
        .update({ status: "deleted" })
        .eq("id", msg.id);
    } else {
      await supabase
        .from("message_delete_queue")
        .update({
          status: "failed",
          error_message: "Failed to delete message via Telegram API",
        })
        .eq("id", msg.id);
    }
  }
}

export function startWorkers(): void {
  const leadService = new LeadService(supabase);

  // Delayed message worker (for delay nodes in flows)
  new Worker<DelayedJobData>(
    "delayed-messages",
    async (job: Job<DelayedJobData>) => {
      const { leadId, flowId, nodeId, botId, chatId } = job.data;

      // Check cache first, then DB
      let bot = botCache.get(botId) as Bot | undefined;
      if (!bot) {
        const { data } = await supabase.from("bots").select("*").eq("id", botId).single();
        if (!data) { console.error(`Bot not found: ${botId}`); return; }
        bot = data as Bot;
        botCache.set(botId, data);
      }

      let flow = flowByIdCache.get(flowId) as unknown as Flow | undefined;
      if (!flow) {
        const { data } = await supabase.from("flows").select("*").eq("id", flowId).single();
        if (!data) { console.error(`Flow not found: ${flowId}`); return; }
        flow = data as Flow;
        flowByIdCache.set(flowId, data);
      }

      const lead = await leadService.getById(leadId);
      if (!lead) {
        console.error(`Lead not found: ${leadId}`);
        return;
      }

      const freshBot = await ensureBotPaymentKeys(botId, bot);
      const telegram = new TelegramApi(freshBot.telegram_token, { protectContent: freshBot.protect_content });
      const { gateway, kind: gatewayKind } = buildGateway(freshBot);
      const processor = new FlowProcessor(
        supabase,
        leadService,
        { addDelayedJob },
        { gateway, gatewayKind, baseWebhookUrl: config.baseWebhookUrl },
      );

      const isBlack = lead.active_flow_name === "_black_flow";
      await processor.executeFlow(flow as Flow, lead, telegram, chatId, nodeId, isBlack);
    },
    {
      connection,
      concurrency: 10,
      limiter: { max: 30, duration: 1000 },
    },
  );

  // Payment timeout worker — fires "not_paid" edge if payment wasn't confirmed
  new Worker<PaymentTimeoutData>(
    "payment-timeout",
    async (job: Job<PaymentTimeoutData>) => {
      const { leadId, flowId, paymentNodeId, externalTransactionId, botId, chatId } = job.data;

      // Check if payment was already approved
      const { data: tx } = await supabase
        .from("transactions")
        .select("status")
        .eq("external_id", externalTransactionId)
        .single();

      if (tx?.status === "approved") {
        console.log(`[payment-timeout] Payment ${externalTransactionId} already approved, skipping timeout`);
        return;
      }

      console.log(`[payment-timeout] Payment ${externalTransactionId} not paid — executing not_paid edge`);

      let bot = botCache.get(botId) as Bot | undefined;
      if (!bot) {
        const { data } = await supabase.from("bots").select("*").eq("id", botId).single();
        if (!data) return;
        bot = data as Bot;
        botCache.set(botId, data);
      }

      let flow = flowByIdCache.get(flowId) as unknown as Flow | undefined;
      if (!flow) {
        const { data } = await supabase.from("flows").select("*").eq("id", flowId).single();
        if (!data) return;
        flow = data as Flow;
        flowByIdCache.set(flowId, data);
      }

      const lead = await leadService.getById(leadId);
      if (!lead) return;

      // Find the "not_paid" edge from the payment node
      const notPaidEdge = flow.flow_data.edges.find(
        (e) => e.source === paymentNodeId && e.sourceHandle === "not_paid",
      );

      if (!notPaidEdge) {
        console.log(`[payment-timeout] No not_paid edge found for node ${paymentNodeId}`);
        return;
      }

      const freshBot = await ensureBotPaymentKeys(botId, bot as Bot);
      const telegram = new TelegramApi(freshBot.telegram_token, { protectContent: freshBot.protect_content });
      const { gateway, kind: gatewayKind } = buildGateway(freshBot);
      const processor = new FlowProcessor(
        supabase,
        leadService,
        { addDelayedJob },
        { gateway, gatewayKind, baseWebhookUrl: config.baseWebhookUrl },
      );

      const isBlack = lead.active_flow_name === "_black_flow";
      await processor.executeFlow(flow, lead, telegram, chatId, notPaidEdge.target, isBlack);
    },
    {
      connection,
      concurrency: 10,
    },
  );

  // Purchase email timeout — dispara Purchase mesmo sem email
  new Worker<PurchaseEmailTimeoutData>(
    "purchase-email-timeout",
    async (job: Job<PurchaseEmailTimeoutData>) => {
      const { leadId, transactionId } = job.data;

      // Lê estado atual do lead — se já não tá esperando email pra essa
      // transação, é porque o user respondeu no tempo (já foi processado)
      const lead = await leadService.getById(leadId);
      if (!lead) return;
      const pending = String(lead.state.pending_email_tx_id ?? "");
      if (pending !== transactionId) {
        console.log(`[purchase-email-timeout] Lead ${leadId} no longer pending for tx ${transactionId} — skip`);
        return;
      }

      const { data: tx } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", transactionId)
        .single();
      if (!tx) return;

      let bot = botCache.get(tx.bot_id) as Bot | undefined;
      if (!bot) {
        const { data } = await supabase.from("bots").select("*").eq("id", tx.bot_id).single();
        if (!data) return;
        bot = data as Bot;
        botCache.set(tx.bot_id, data);
      }
      const freshBot = await ensureBotPaymentKeys(tx.bot_id, bot);

      console.log(`[purchase-email-timeout] 2h elapsed, dispatching Purchase WITHOUT email for lead ${leadId}`);
      const { completePurchase } = await import("./services/purchase-completer.js");
      await completePurchase(supabase, freshBot, lead, tx);
    },
    {
      connection,
      concurrency: 4,
    },
  );

  // Black flow message deletion — poll every 30 seconds
  setInterval(() => {
    processMessageDeletions().catch((err) =>
      console.error("[black-delete] Error:", err)
    );
  }, 30_000);

  // Run once at startup to catch any overdue deletions
  processMessageDeletions().catch((err) =>
    console.error("[black-delete] Startup error:", err)
  );

  // Remarketing worker — poll every 60 seconds, com trava in-process
  // pra evitar execuções sobrepostas (causa de duplicação de mensagens).
  let remarketingRunning = false;
  setInterval(() => {
    if (remarketingRunning) {
      console.log("[remarketing] Skip tick — execução anterior ainda em progresso");
      return;
    }
    remarketingRunning = true;
    processRemarketing(supabase)
      .catch((err) => console.error("[remarketing] Error:", err))
      .finally(() => {
        remarketingRunning = false;
      });
  }, 60_000);

  // MTProto: auto-sync periódico de dialogs por conta ativa.
  // A cada 30 min, pega contas ativas cuja sincronização mais recente é
  // > 24h (ou nunca sincronizou) e enfileira account.sync-dialogs.
  // Mantém a base de contatos fresca pra campanhas globais sem o user
  // precisar clicar manualmente.
  let mtprotoSyncRunning = false;
  async function tickMtprotoAutoSync(): Promise<void> {
    if (mtprotoSyncRunning) return;
    mtprotoSyncRunning = true;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: accounts } = await supabase
        .from("mtproto_accounts")
        .select("id")
        .eq("status", "active")
        .limit(200);
      if (!accounts || accounts.length === 0) return;
      const { enqueueMtproto } = await import("./queue-mtproto.js");
      for (const a of accounts) {
        // Última sincronização dessa conta
        const { data: lastDialog } = await supabase
          .from("mtproto_dialogs")
          .select("last_synced_at")
          .eq("account_id", a.id)
          .order("last_synced_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastSync = lastDialog?.last_synced_at ?? null;
        if (!lastSync || lastSync < cutoff) {
          await enqueueMtproto({ kind: "account.sync-dialogs", accountId: a.id });
          console.log(`[mtproto-autosync] enqueued sync for account ${a.id} (last=${lastSync ?? "never"})`);
        }
      }
    } catch (err) {
      console.error("[mtproto-autosync] Error:", err);
    } finally {
      mtprotoSyncRunning = false;
    }
  }
  setInterval(() => {
    tickMtprotoAutoSync();
  }, 30 * 60 * 1000); // 30 min
  // Roda 30s depois do start pra dar tempo do worker subir
  setTimeout(() => tickMtprotoAutoSync(), 30_000);

  // MTProto: health check — a cada 10min verifica se cada conta ainda tá
  // logada no Telegram (sessão válida). Se o user deslogou pelo app oficial,
  // a sessão dele aqui fica zumbi até a próxima campanha estourar
  // AUTH_KEY_UNREGISTERED. Esse poller mata logo pra não acumular sujeira.
  // Deleta contas com sessão inválida (cascade limpa dialogs/targets/inbox).
  let mtprotoHealthRunning = false;
  async function tickMtprotoHealth(): Promise<void> {
    if (mtprotoHealthRunning) return;
    mtprotoHealthRunning = true;
    try {
      if (!config.telegramApiId || !config.telegramApiHash) return;
      // Pula contas pending/code_sent/needs_password (login em curso) —
      // session_string ainda não existe ou ainda não está estável.
      const { data: accounts } = await supabase
        .from("mtproto_accounts")
        .select("id, phone_number, status, session_string")
        .not("session_string", "is", null)
        .in("status", ["active", "flood_wait", "banned", "disconnected"])
        .limit(500);
      if (!accounts || accounts.length === 0) return;
      const { MtprotoClient } = await import("./services/mtproto/client.js");
      for (const acc of accounts) {
        if (!acc.session_string) continue;
        const client = new MtprotoClient(
          config.telegramApiId,
          config.telegramApiHash,
          acc.session_string,
        );
        try {
          await client.healthCheck();
          // OK — se estava 'disconnected' por erro transiente, marca active
          if (acc.status === "disconnected") {
            await supabase
              .from("mtproto_accounts")
              .update({ status: "active", last_error: null })
              .eq("id", acc.id);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const fatal = /AUTH_KEY|USER_DEACTIVATED|SESSION_REVOKED|PHONE_NUMBER_BANNED/i.test(msg);
          if (fatal) {
            console.warn(`[mtproto-health] conta ${acc.id} (${acc.phone_number}) inválida: ${msg} — deletando`);
            await supabase.from("mtproto_accounts").delete().eq("id", acc.id);
          } else {
            console.warn(`[mtproto-health] conta ${acc.id} erro não-fatal (mantém): ${msg}`);
          }
        } finally {
          await client.disconnect().catch(() => {});
        }
      }
    } catch (err) {
      console.error("[mtproto-health] Error:", err);
    } finally {
      mtprotoHealthRunning = false;
    }
  }
  setInterval(() => tickMtprotoHealth(), 10 * 60 * 1000); // 10 min
  setTimeout(() => tickMtprotoHealth(), 45_000); // primeira rodada 45s após boot

  // MTProto: dispara campanhas recorrentes que chegaram na hora.
  // Roda a cada 30s; pega mtproto_campaigns com status='scheduled' e
  // next_run_at <= now e enfileira campaign.run.
  let recurrentMtprotoRunning = false;
  setInterval(() => {
    if (recurrentMtprotoRunning) return;
    recurrentMtprotoRunning = true;
    (async () => {
      try {
        const { data: due } = await supabase
          .from("mtproto_campaigns")
          .select("id")
          .eq("status", "scheduled")
          .not("recurrence_hours", "is", null)
          .lte("next_run_at", new Date().toISOString())
          .limit(20);
        if (!due || due.length === 0) return;
        const { enqueueMtproto } = await import("./queue-mtproto.js");
        for (const c of due) {
          // Marca como queued antes de enfileirar pra evitar tick duplicado
          await supabase
            .from("mtproto_campaigns")
            .update({ status: "running" })
            .eq("id", c.id)
            .eq("status", "scheduled");
          await enqueueMtproto({ kind: "campaign.run", campaignId: c.id });
          console.log(`[mtproto-recurrent] dispatched campaign ${c.id}`);
        }
      } catch (err) {
        console.error("[mtproto-recurrent] Error:", err);
      } finally {
        recurrentMtprotoRunning = false;
      }
    })();
  }, 30_000);

  // Cleanup diário de inbox messages: apaga registros com mais de 7 dias.
  async function cleanupInboxMessages(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error, count } = await supabase
      .from("mtproto_incoming_messages")
      .delete({ count: "exact" })
      .lt("received_at", cutoff);
    if (error) {
      console.error("[inbox-cleanup] error:", error);
      return;
    }
    if (count && count > 0) console.log(`[inbox-cleanup] removed ${count} msgs older than 7d`);
  }
  setInterval(() => cleanupInboxMessages(), 24 * 60 * 60 * 1000);
  setTimeout(() => cleanupInboxMessages(), 60_000);

  // Cleanup diário do chat da aba Clientes: apaga mensagens com mais de 30 dias.
  async function cleanupLeadMessages(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error, count } = await supabase
      .from("lead_messages")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);
    if (error) {
      console.error("[lead-messages-cleanup] error:", error);
      return;
    }
    if (count && count > 0) console.log(`[lead-messages-cleanup] removed ${count} msgs older than 30d`);
  }
  setInterval(() => cleanupLeadMessages(), 24 * 60 * 60 * 1000);
  setTimeout(() => cleanupLeadMessages(), 90_000);

  // EvPay status poller — fallback caso o webhook automático do Yvepay
  // não dispare. Roda a cada 5s, mas só consulta cada transação no
  // intervalo apropriado por idade (5s pra recém-criadas, 30s/2min
  // pras mais antigas) — ver workers/evpay-poller.ts.
  // Trava anti-sobreposição: se uma rodada demora mais que o intervalo
  // (ex: Yvepay lenta), a próxima NÃO empilha em cima — senão os fetches
  // pendurados se acumulam e saturam o pool do undici ("fetch failed" em
  // loop). Mesmo padrão do remarketing e do channel-monitor.
  let evpayPollerRunning = false;
  setInterval(() => {
    if (evpayPollerRunning) return;
    evpayPollerRunning = true;
    pollEvpayPendingTransactions(supabase)
      .catch((err) => console.error("[evpay-poller] Error:", err))
      .finally(() => {
        evpayPollerRunning = false;
      });
  }, 5_000);

  // Poseidon Pay status poller — DESLIGADO por enquanto.
  // A Poseidon não tem endpoint público de consulta de status (todos
  // os GETs que tentamos retornaram 403 pelo Cloudflare). Manter o
  // poller ligado spammava 100+ requests/min sem nenhum benefício.
  // Quando a Poseidon documentar o endpoint correto, religar aqui:
  //   pollPoseidonPendingTransactions(supabase).catch(...);
  //
  // Por enquanto confiamos no webhook automático da Poseidon
  // (que já é robusto pelo nosso lado: CAS, idempotência, fallback).
  void pollPoseidonPendingTransactions; // mantém import vivo p/ futuro

  // Channel monitor poller — a cada 10 min checa cada canal monitorado.
  // Se canal caiu ou conta dona foi banida, dispara substituição automática
  // por outra conta + template configurado pelo owner.
  let channelMonitorRunning = false;
  async function tickChannelMonitor(): Promise<void> {
    if (channelMonitorRunning) return;
    channelMonitorRunning = true;
    try {
      await pollChannelMonitors(supabase);
    } catch (err) {
      console.error("[channel-monitor] Error:", err);
    } finally {
      channelMonitorRunning = false;
    }
  }
  setInterval(() => tickChannelMonitor(), 10 * 60 * 1000);
  setTimeout(() => tickChannelMonitor(), 60_000); // 1 min após boot

  console.log("BullMQ workers + black deletion + remarketing + evpay-poller + channel-monitor started");
}
