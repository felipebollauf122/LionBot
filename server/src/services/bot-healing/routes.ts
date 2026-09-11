import { Router } from "express";
import { config } from "../../config.js";
import { supabase } from "../../db.js";
import { isAuthorizedInternalRequest } from "../mtproto/internal-auth.js";
import { tenantHasHealing } from "./access.js";
import { loadHealingBot, loadHealingSettings, scheduleHealingCheck } from "./runtime.js";
import { tokenHash } from "./recovery.js";

export const botHealingRouter = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

botHealingRouter.use("/:botId/auto-healing", async (req, res, next) => {
  if (!isAuthorizedInternalRequest(config.internalApiSecret, req.headers["x-internal-secret"])) {
    res.status(403).json({ error: "unauthorized" }); return;
  }
  const tenantId = req.method === "GET" ? req.query.tenantId : req.body?.tenantId;
  if (typeof tenantId !== "string" || !uuid.test(tenantId) || !uuid.test(String(req.params.botId))) {
    res.status(400).json({ error: "invalid_bot_or_tenant" }); return;
  }
  try {
    const bot = await loadHealingBot(String(req.params.botId));
    if (!bot || bot.tenant_id !== tenantId) { res.status(404).json({ error: "bot_not_found" }); return; }
    // Depois da posse, nunca antes: quem chuta um bot alheio recebe 404 sem
    // descobrir se aquele tenant assina. Uma leitura de plano que falha cai no
    // catch como indisponibilidade — recusar seria mentir para o assinante.
    if (!await tenantHasHealing(tenantId)) { res.status(403).json({ error: "healing_not_available" }); return; }
    res.locals.healingBot = bot;
    next();
  } catch { res.status(503).json({ error: "healing_storage_unavailable" }); }
});

botHealingRouter.get("/:botId/auto-healing", async (_req, res) => {
  try {
    const bot = res.locals.healingBot;
    const settings = await loadHealingSettings(bot.id);
    const result = await supabase.from("bot_recovery_runs").select("id,status,new_username,retry_at,error_code,created_at,updated_at").eq("bot_id", bot.id).eq("tenant_id", bot.tenant_id).order("created_at", { ascending: false }).limit(20);
    if (result.error) throw new Error("status_read_failed");
    res.json({ workerEnabled: config.botAutoHealEnabled, enabled: settings.enabled, accountIds: settings.account_ids, backedUpAt: settings.backed_up_at, identityReady: !!settings.identity && settings.identity_token_hash === tokenHash(bot.telegram_token), runs: result.data });
  } catch { res.status(503).json({ error: "healing_storage_unavailable" }); }
});

botHealingRouter.post("/:botId/auto-healing", async (req, res) => {
  const { enabled, accountIds } = req.body ?? {};
  if (typeof enabled !== "boolean" || !Array.isArray(accountIds) || accountIds.length > 20 || accountIds.some(id => typeof id !== "string" || !uuid.test(id))) {
    res.status(400).json({ error: "provide_enabled_and_accountIds" }); return;
  }
  try {
    const bot = res.locals.healingBot;
    const ids = [...new Set(accountIds)] as string[];
    if (ids.length) {
      const accounts = await supabase.from("mtproto_accounts").select("id").eq("tenant_id", bot.tenant_id).in("id", ids);
      if (accounts.error) throw new Error("accounts_read_failed");
      if (accounts.data?.length !== ids.length) { res.status(400).json({ error: "account_not_owned_by_tenant" }); return; }
    }
    const result = await supabase.from("bot_recovery_settings").upsert({ bot_id: bot.id, enabled, account_ids: ids }, { onConflict: "bot_id" });
    if (result.error) throw new Error("settings_write_failed");
    if (enabled) await scheduleHealingCheck(bot.id);
    res.json({ enabled, accountIds: ids, workerEnabled: config.botAutoHealEnabled });
  } catch { res.status(503).json({ error: "healing_storage_unavailable" }); }
});

botHealingRouter.post("/:botId/auto-healing/retry", async (_req, res) => {
  try {
    const bot = res.locals.healingBot;
    const settings = await loadHealingSettings(bot.id);
    if (!bot.is_active || !settings.enabled || !config.botAutoHealEnabled) { res.status(409).json({ error: "healing_disabled" }); return; }
    // Preserve the staged token and the ambiguous-send checkpoint on every retry.
    const result = await supabase.from("bot_recovery_runs").update({ status: "queued", retry_at: null, error_code: null, updated_at: new Date().toISOString() }).eq("bot_id", bot.id).eq("tenant_id", bot.tenant_id).eq("token_hash", tokenHash(bot.telegram_token)).eq("status", "needs_attention").select("id").maybeSingle();
    if (result.error) throw new Error("retry_write_failed");
    if (!result.data) { res.status(409).json({ error: "no_recoverable_run" }); return; }
    await scheduleHealingCheck(bot.id);
    res.status(202).json({ runId: result.data.id });
  } catch { res.status(503).json({ error: "healing_storage_unavailable" }); }
});
