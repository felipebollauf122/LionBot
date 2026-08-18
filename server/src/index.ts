import express from "express";
import { config } from "./config.js";
import { handleTelegramWebhook } from "./webhook/telegram.js";
import { handlePaymentWebhookGlobal, handlePaymentWebhook, handleEvPayWebhook, handleZuckPayWebhook } from "./webhook/payment.js";
import { startWorkers } from "./queue.js";
import { startMtprotoWorker } from "./workers/mtproto-worker.js";
import { enqueueMtproto, type MtprotoJobData } from "./queue-mtproto.js";
import { supabase } from "./db.js";
import { TelegramApi } from "./telegram/api.js";
import { botCache, flowCache, flowByIdCache } from "./cache.js";

interface Bot {
  id: string;
  tenant_id: string;
  telegram_token: string;
}

const app = express();

// ngrok free tier requires this header to skip browser warning page
app.use((_req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

// CORS — allow dashboard (Next.js) to call the API
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Parse JSON bodies (Telegram sends JSON webhooks).
// 'verify' guarda o buffer original em req.rawBody — necessário pra
// validar HMAC do webhook do Yvepay/EvPay (precisa do byte-stream cru).
app.use(
  express.json({
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "eaglebot-engine" });
});

// Diagnóstico do Web Push: mostra QUAL chave pública o server carregou (do .env)
// e se a privada está setada — SEM expor a privada. Pra conferir se a VPS está
// com o par VAPID certo. (Endpoint de leitura, seguro.)
app.get("/health/push", (_req, res) => {
  const pub = config.vapidPublicKey || "";
  res.json({
    vapidPublicKey: pub, // pública pode ser exposta
    vapidPublicKeyLen: pub.length,
    vapidPrivateKeySet: Boolean(config.vapidPrivateKey),
    vapidPrivateKeyLen: (config.vapidPrivateKey || "").length,
    vapidSubject: config.vapidSubject || "",
    pushEnabled: Boolean(config.vapidPublicKey && config.vapidPrivateKey),
  });
});

// SigiloPay payment webhook — single global endpoint for the entire platform
app.post("/webhook/payment", handlePaymentWebhookGlobal);
// Legacy per-bot endpoint (kept for existing webhooks already registered at SigiloPay)
app.post("/webhook/payment/:botId", handlePaymentWebhook);
// EvPay payment webhook — global, valida HMAC com secret salvo por bot
app.post("/webhook/evpay", handleEvPayWebhook);
// ZuckPay payment webhook — global, valida HMAC (X-ZuckPay-Signature) por bot.
// DEVE vir antes do catch-all /webhook/:botId (senão o Telegram handler engole).
app.post("/webhook/zuckpay", handleZuckPayWebhook);

// Telegram webhook endpoint
app.post("/webhook/:botId", handleTelegramWebhook);

// Register webhook for a bot (called from dashboard when bot is activated)
app.post("/api/bots/:botId/register-webhook", async (req, res) => {
  try {
    const { botId } = req.params;

    const { data: bot } = await supabase
      .from("bots")
      .select("*")
      .eq("id", botId)
      .single();

    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const typedBot = bot as Bot;
    const webhookUrl = `${config.baseWebhookUrl}/webhook/${botId}`;
    const telegram = new TelegramApi(typedBot.telegram_token);
    await telegram.setWebhook(webhookUrl);

    // Update webhook_url in database
    await supabase
      .from("bots")
      .update({ webhook_url: webhookUrl, is_active: true })
      .eq("id", botId);

    botCache.invalidate(botId);
    res.json({ success: true, webhook_url: webhookUrl });
  } catch (error) {
    console.error("Failed to register webhook:", error);
    res.status(500).json({ error: "Failed to register webhook" });
  }
});

// Diagnóstico do webhook EvPay — lista os webhooks cadastrados no projeto
// pra você confirmar se o nosso URL realmente está lá.
app.get("/api/bots/:botId/evpay-webhook-status", async (req, res) => {
  try {
    const { botId } = req.params;
    const { data: bot } = await supabase
      .from("bots")
      .select("evpay_api_key, evpay_project_id, evpay_webhook_id, evpay_webhook_secret")
      .eq("id", botId)
      .single();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const typedBot = bot as {
      evpay_api_key: string | null;
      evpay_project_id: string | null;
      evpay_webhook_id: string | null;
      evpay_webhook_secret: string | null;
    };
    if (!typedBot.evpay_api_key || !typedBot.evpay_project_id) {
      res.status(400).json({ error: "EvPay credentials missing" });
      return;
    }
    const { EvPay } = await import("./services/evpay.js");
    const evpay = new EvPay(typedBot.evpay_api_key, typedBot.evpay_project_id);
    const webhooks = await evpay.listWebhooks();
    const expectedUrl = `${config.baseWebhookUrl}/webhook/evpay`;
    const matching = webhooks.find((w) => w.url === expectedUrl);
    res.json({
      success: true,
      expectedUrl,
      hasSecret: !!typedBot.evpay_webhook_secret,
      savedWebhookId: typedBot.evpay_webhook_id,
      registeredAtYvepay: !!matching,
      matchingWebhook: matching ?? null,
      allWebhooks: webhooks,
    });
  } catch (error) {
    console.error("Failed to fetch EvPay webhook status:", error);
    const msg = error instanceof Error ? error.message : "unknown";
    res.status(500).json({ error: msg });
  }
});

// Conserta o webhook EvPay: apaga TODOS os webhooks cadastrados no projeto
// (que podem estar com URL antiga/errada) e re-registra a URL correta atual.
// Use quando o webhook "não chega" — geralmente é URL velha cadastrada que
// o 409 mascarava no setup normal.
app.post("/api/bots/:botId/evpay-webhook-repair", async (req, res) => {
  try {
    const { botId } = req.params;
    const { data: bot } = await supabase
      .from("bots")
      .select("id, evpay_api_key, evpay_project_id, evpay_webhook_secret")
      .eq("id", botId)
      .single();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const typedBot = bot as {
      id: string;
      evpay_api_key: string | null;
      evpay_project_id: string | null;
      evpay_webhook_secret: string | null;
    };
    if (!typedBot.evpay_api_key || !typedBot.evpay_project_id) {
      res.status(400).json({ error: "EvPay credentials missing" });
      return;
    }

    const { EvPay } = await import("./services/evpay.js");
    const evpay = new EvPay(typedBot.evpay_api_key, typedBot.evpay_project_id);
    const expectedUrl = `${config.baseWebhookUrl}/webhook/evpay`;

    // 1) Lista o que tá cadastrado e apaga TUDO (limpa URLs erradas/duplicadas)
    const existing = await evpay.listWebhooks();
    const deleted: string[] = [];
    for (const w of existing) {
      const ok = await evpay.deleteWebhook(w.id);
      if (ok) deleted.push(`${w.id} (${w.url})`);
    }

    // 2) Gera secret novo se não tiver e re-registra a URL CORRETA
    let secret = typedBot.evpay_webhook_secret;
    if (!secret || secret.length < 16) {
      const { randomBytes } = await import("crypto");
      secret = `whsec_${randomBytes(24).toString("hex")}`;
    }
    const { webhookId } = await evpay.registerWebhook(expectedUrl, secret);
    await supabase
      .from("bots")
      .update({ evpay_webhook_secret: secret, evpay_webhook_id: webhookId })
      .eq("id", botId);
    botCache.invalidate(botId);

    res.json({
      success: true,
      registeredUrl: expectedUrl,
      newWebhookId: webhookId,
      deletedOld: deleted,
    });
  } catch (error) {
    console.error("Failed to repair EvPay webhook:", error);
    const msg = error instanceof Error ? error.message : "unknown";
    res.status(500).json({ error: msg });
  }
});

// Reconcilia transações EvPay presas em "pending": consulta o status atual
// de cada uma na API do Yvepay e, se já está paga (PAID_OUT/APPROVED),
// dispara o pipeline de confirmação (marca approved + entrega o produto).
// Usado pra recuperar vendas que ficaram órfãs quando o webhook/poller falhou.
// Query param opcional ?hours=72 controla a janela (padrão 72h, máx 168h).
app.post("/api/bots/:botId/evpay-reconcile", async (req, res) => {
  try {
    const { botId } = req.params;
    const hours = Math.min(
      168,
      Math.max(1, Number(req.query.hours ?? 72) || 72),
    );

    const { data: bot } = await supabase
      .from("bots")
      .select("id, tenant_id, evpay_api_key, evpay_project_id")
      .eq("id", botId)
      .single();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const typedBot = bot as {
      id: string;
      tenant_id: string;
      evpay_api_key: string | null;
      evpay_project_id: string | null;
    };
    if (!typedBot.evpay_api_key || !typedBot.evpay_project_id) {
      res.status(400).json({ error: "EvPay credentials missing" });
      return;
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data: pending } = await supabase
      .from("transactions")
      .select("id, external_id, created_at")
      .eq("bot_id", botId)
      .eq("gateway", "evpay")
      .eq("status", "pending")
      .gte("created_at", since)
      .limit(500);

    const txs = (pending ?? []) as Array<{ id: string; external_id: string; created_at: string }>;

    const { EvPay } = await import("./services/evpay.js");
    const evpay = new EvPay(typedBot.evpay_api_key, typedBot.evpay_project_id);
    const { processPaymentCallback } = await import("./webhook/payment.js");

    let approved = 0;
    let stillPending = 0;
    let notFound = 0;
    let errors = 0;
    const recovered: string[] = [];

    for (const tx of txs) {
      try {
        const r = await evpay.getPaymentStatus(tx.external_id);
        if (!r) {
          notFound++;
          continue;
        }
        const status = String(r.status).toUpperCase();
        if (["APPROVED", "PAID", "PAID_OUT", "PAIDOUT", "COMPLETED", "SUCCESS"].includes(status)) {
          await processPaymentCallback(botId, { transactionId: tx.external_id, status });
          approved++;
          recovered.push(tx.external_id);
        } else {
          stillPending++;
        }
      } catch (err) {
        errors++;
        console.error(`[evpay-reconcile] erro tx ${tx.external_id}:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[evpay-reconcile] bot=${botId} janela=${hours}h total=${txs.length} aprovadas=${approved} pendentes=${stillPending} naoEncontradas=${notFound} erros=${errors}`);
    res.json({
      success: true,
      windowHours: hours,
      scanned: txs.length,
      approvedNow: approved,
      stillPending,
      notFound,
      errors,
      recovered,
    });
  } catch (error) {
    console.error("Failed to reconcile EvPay transactions:", error);
    const msg = error instanceof Error ? error.message : "unknown";
    res.status(500).json({ error: msg });
  }
});

// Setup EvPay webhook for a bot (called from dashboard when EvPay credentials are saved)
app.post("/api/bots/:botId/setup-evpay-webhook", async (req, res) => {
  try {
    const { botId } = req.params;

    const { data: bot } = await supabase
      .from("bots")
      .select("id, evpay_api_key, evpay_project_id, evpay_webhook_secret")
      .eq("id", botId)
      .single();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const typedBot = bot as {
      id: string;
      evpay_api_key: string | null;
      evpay_project_id: string | null;
      evpay_webhook_secret: string | null;
    };

    if (!typedBot.evpay_api_key || !typedBot.evpay_project_id) {
      res.status(400).json({ error: "EvPay credentials missing" });
      return;
    }

    // Gera (ou reusa) o secret do webhook — mínimo 16 chars exigido pelo EvPay
    let secret = typedBot.evpay_webhook_secret;
    if (!secret || secret.length < 16) {
      const { randomBytes } = await import("crypto");
      secret = `whsec_${randomBytes(24).toString("hex")}`;
    }

    const { EvPay } = await import("./services/evpay.js");
    const evpay = new EvPay(typedBot.evpay_api_key, typedBot.evpay_project_id);
    const webhookUrl = `${config.baseWebhookUrl}/webhook/evpay`;

    const { webhookId } = await evpay.registerWebhook(webhookUrl, secret);

    await supabase
      .from("bots")
      .update({
        evpay_webhook_secret: secret,
        evpay_webhook_id: webhookId,
      })
      .eq("id", botId);

    botCache.invalidate(botId);
    res.json({ success: true, webhook_url: webhookUrl, webhook_id: webhookId });
  } catch (error) {
    console.error("Failed to setup EvPay webhook:", error);
    const msg = error instanceof Error ? error.message : "unknown";
    res.status(500).json({ error: `setup failed: ${msg}` });
  }
});

// MTProto inbox (Telegram oficial 777000) — abre/heartbeat/fecha sessão
app.post("/api/mtproto/inbox/open", async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: string };
    if (!accountId) {
      res.status(400).json({ error: "missing accountId" });
      return;
    }
    const { openInbox } = await import("./services/mtproto/inbox-manager.js");
    const result = await openInbox(accountId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[inbox/open]", err);
    res.status(500).json({ error: "open failed" });
  }
});

app.post("/api/mtproto/inbox/heartbeat", async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: string };
    if (!accountId) {
      res.status(400).json({ error: "missing accountId" });
      return;
    }
    const { heartbeatInbox } = await import("./services/mtproto/inbox-manager.js");
    const ok = await heartbeatInbox(accountId);
    res.json({ alive: ok });
  } catch {
    res.status(500).json({ error: "heartbeat failed" });
  }
});

app.post("/api/mtproto/inbox/close", async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: string };
    if (!accountId) {
      res.status(400).json({ error: "missing accountId" });
      return;
    }
    const { closeInbox } = await import("./services/mtproto/inbox-manager.js");
    await closeInbox(accountId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "close failed" });
  }
});

// MTProto job enqueue — called from dashboard server actions
app.post("/api/mtproto/enqueue", async (req, res) => {
  try {
    const job = req.body as MtprotoJobData;
    if (!job?.kind) {
      res.status(400).json({ error: "invalid job" });
      return;
    }
    await enqueueMtproto(job);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to enqueue mtproto job:", error);
    res.status(500).json({ error: "enqueue failed" });
  }
});

// Reenvio manual de acesso — chamado pelo painel ("Pagou e não recebeu").
// Reentrega o produto/mensagens de uma transação aprovada. Tracking não
// duplica (sent_to_facebook protege). Processa em lote com espaçamento.
app.post("/api/transactions/redeliver", async (req, res) => {
  try {
    const { transactionIds } = req.body as { transactionIds?: string[] };
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      res.status(400).json({ error: "transactionIds vazio" });
      return;
    }
    // Responde já e processa em background (lote grande pode demorar).
    res.json({ success: true, queued: transactionIds.length });

    const { redeliverTransaction } = await import("./webhook/payment.js");
    let ok = 0;
    let fail = 0;
    for (const txId of transactionIds.slice(0, 1000)) {
      const r = await redeliverTransaction(txId);
      if (r.ok) ok++;
      else {
        fail++;
        console.warn(`[redeliver] tx ${txId}: ${r.reason}`);
      }
      // Espaça pra não floodar o Telegram (rate limit por bot)
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log(`[redeliver] lote concluído: ${ok} ok, ${fail} falhas`);
  } catch (error) {
    console.error("[redeliver] erro:", error);
  }
});

// Cache invalidation — called from dashboard when bot settings or flows are saved
app.post("/api/bots/:botId/invalidate-cache", async (_req, res) => {
  const { botId } = _req.params;
  botCache.invalidate(botId);
  flowCache.invalidate(botId);
  // Limpa também o cache do renderer do bot de login MTProto
  try {
    const { invalidateLoginFlowCache } = await import("./webhook/mtproto-login-renderer.js");
    invalidateLoginFlowCache(botId);
  } catch {
    /* não-fatal */
  }
  console.log(`[cache] Invalidated cache for bot ${botId}`);
  res.json({ success: true });
});

// Delete bot — tira webhook do Telegram + apaga registro do DB.
// Tabelas com FK cascade (flows, leads, transactions, blacklist, etc.) são
// limpas automaticamente. mtproto_accounts.created_via_bot_id e
// tenant_lead_identity.{first,last}_bot_id ficam set null. Tokens/segredos
// nunca são logados.
app.post("/api/bots/:botId/delete", async (req, res) => {
  try {
    const { botId } = req.params;
    const { data: bot } = await supabase
      .from("bots")
      .select("id, telegram_token")
      .eq("id", botId)
      .single();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    // Tira webhook do Telegram (best-effort; se o token tá inválido tudo bem)
    try {
      const telegram = new TelegramApi(bot.telegram_token);
      await telegram.deleteWebhook();
    } catch (err) {
      console.warn(`[delete-bot] deleteWebhook falhou (não-fatal):`, err);
    }
    // Apaga o bot — cascades limpam o resto
    const { error } = await supabase.from("bots").delete().eq("id", botId);
    if (error) {
      console.error("[delete-bot] supabase delete failed:", error);
      res.status(500).json({ error: error.message });
      return;
    }
    botCache.invalidate(botId);
    flowCache.invalidate(botId);
    try {
      const { invalidateLoginFlowCache } = await import("./webhook/mtproto-login-renderer.js");
      invalidateLoginFlowCache(botId);
    } catch { /* não-fatal */ }
    console.log(`[delete-bot] bot ${botId} deletado`);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete bot:", error);
    res.status(500).json({ error: "Failed to delete bot" });
  }
});

// Deactivate bot (remove webhook)
app.post("/api/bots/:botId/deactivate", async (req, res) => {
  try {
    const { botId } = req.params;

    const { data: bot } = await supabase
      .from("bots")
      .select("*")
      .eq("id", botId)
      .single();

    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const typedBot = bot as Bot;
    const telegram = new TelegramApi(typedBot.telegram_token);
    await telegram.deleteWebhook();

    await supabase
      .from("bots")
      .update({ webhook_url: null, is_active: false })
      .eq("id", botId);

    botCache.invalidate(botId);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to deactivate bot:", error);
    res.status(500).json({ error: "Failed to deactivate bot" });
  }
});

// Envio manual de mensagem pelo painel (aba Clientes / chat ao vivo).
// O operador responde um lead pelo bot; gravamos o 'out' na timeline.
// Auth: a server-action do front valida dono/admin antes de chamar (RLS
// no select do lead). Aqui revalidamos que o lead pertence ao bot.
app.post("/api/bots/:botId/send-message", async (req, res) => {
  try {
    const { botId } = req.params;
    const { leadId, text } = req.body as { leadId?: string; text?: string };

    const trimmed = (text ?? "").trim();
    if (!leadId || !trimmed) {
      res.status(400).json({ error: "missing leadId or text" });
      return;
    }
    if (trimmed.length > 4096) {
      res.status(400).json({ error: "text too long" });
      return;
    }

    // Lead precisa pertencer a este bot (defesa em profundidade).
    const { data: lead } = await supabase
      .from("leads")
      .select("id, bot_id, tenant_id, telegram_user_id")
      .eq("id", leadId)
      .eq("bot_id", botId)
      .single();
    if (!lead) {
      res.status(404).json({ error: "lead not found for this bot" });
      return;
    }

    const { data: bot } = await supabase
      .from("bots")
      .select("telegram_token, protect_content")
      .eq("id", botId)
      .single();
    if (!bot) {
      res.status(404).json({ error: "bot not found" });
      return;
    }

    const typedBot = bot as { telegram_token: string; protect_content: boolean };
    const telegram = new TelegramApi(typedBot.telegram_token, { protectContent: typedBot.protect_content });

    let sent;
    try {
      sent = await telegram.sendMessage({ chatId: Number(lead.telegram_user_id), text: trimmed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Lead bloqueou o bot → Telegram devolve 403 Forbidden.
      if (/bot was blocked by the user|Forbidden|chat not found|user is deactivated/i.test(msg)) {
        await supabase.from("leads").update({ blocked: true }).eq("id", lead.id);
        res.status(409).json({ error: "blocked", message: "O lead bloqueou o bot." });
        return;
      }
      console.error("[send-message] telegram error:", msg);
      res.status(502).json({ error: "telegram send failed" });
      return;
    }

    // Grava o 'out' na timeline (a mesma mensagem volta pro painel via Realtime).
    const { logOutgoing } = await import("./services/lead-messages.js");
    logOutgoing(
      { leadId: lead.id, botId: lead.bot_id, tenantId: lead.tenant_id },
      trimmed,
      sent?.message_id,
    );

    res.json({ success: true, message_id: sent?.message_id ?? null });
  } catch (error) {
    console.error("[send-message] failed:", error);
    res.status(500).json({ error: "send failed" });
  }
});

// Start server
const server = app.listen(config.port, () => {
  console.log(`EagleBot Engine running on port ${config.port}`);
  startWorkers();
  startMtprotoWorker();
});

// Graceful shutdown (#46): no SIGTERM/SIGINT (deploy, restart do Docker),
// desconecta as conexões MTProto vivas e fecha o HTTP server antes de sair,
// evitando conexões zumbi pro Telegram.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] recebido ${signal} — encerrando graciosamente`);
  try {
    const { shutdownMtprotoClients } = await import("./workers/mtproto-worker.js");
    await shutdownMtprotoClients();
  } catch (e) {
    console.error("[shutdown] erro ao desconectar MTProto:", e);
  }
  server.close(() => {
    console.log("[shutdown] HTTP server fechado");
    process.exit(0);
  });
  // Força saída se demorar demais
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

export { app };
