"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { invalidateBotCache } from "@/lib/actions/cache-actions";

interface BotSettings {
  facebook_pixel_id: string;
  facebook_access_token: string;
  facebook_pixel_id_backup: string;
  facebook_access_token_backup: string;
  facebook_backup_enabled: boolean;
  utmify_api_key: string;
  payment_gateway: "sigilopay" | "evpay";
  sigilopay_public_key: string;
  sigilopay_secret_key: string;
  evpay_api_key: string;
  evpay_project_id: string;
  collect_email_after_payment: boolean;
  email_request_message: string;
  tracking_mode: "redirect" | "prelander";
  prelander_headline: string;
  prelander_description: string;
  prelander_image_url: string;
  prelander_cta_text: string;
  redirect_display_name: string;
  tracking_page_intro: string;
}

async function registerEvpayWebhookOnServer(botId: string): Promise<void> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  try {
    await fetch(`${serverUrl}/api/bots/${botId}/setup-evpay-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Silent fail — UI mostra erro só se realmente o pagamento der ruim
  }
}

export async function saveBotSettings(botId: string, settings: BotSettings) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Verify bot belongs to this tenant (admins can access any bot)
  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { error } = await supabase
    .from("bots")
    .update({
      facebook_pixel_id: settings.facebook_pixel_id || null,
      facebook_access_token: settings.facebook_access_token || null,
      facebook_pixel_id_backup: settings.facebook_pixel_id_backup || null,
      facebook_access_token_backup: settings.facebook_access_token_backup || null,
      facebook_backup_enabled: settings.facebook_backup_enabled,
      utmify_api_key: settings.utmify_api_key || null,
      payment_gateway: settings.payment_gateway,
      sigilopay_public_key: settings.sigilopay_public_key || null,
      sigilopay_secret_key: settings.sigilopay_secret_key || null,
      evpay_api_key: settings.evpay_api_key || null,
      evpay_project_id: settings.evpay_project_id || null,
      collect_email_after_payment: settings.collect_email_after_payment,
      email_request_message: settings.email_request_message || null,
      tracking_mode: settings.tracking_mode,
      prelander_headline: settings.prelander_headline || null,
      prelander_description: settings.prelander_description || null,
      prelander_image_url: settings.prelander_image_url || null,
      prelander_cta_text: settings.prelander_cta_text || null,
      redirect_display_name: settings.redirect_display_name || null,
      tracking_page_intro: settings.tracking_page_intro || null,
    })
    .eq("id", botId);

  if (error) throw new Error(`Failed to save settings: ${error.message}`);
  invalidateBotCache(botId);

  // Se o gateway é EvPay e tem credenciais, manda o server registrar o webhook
  if (
    settings.payment_gateway === "evpay" &&
    settings.evpay_api_key &&
    settings.evpay_project_id
  ) {
    await registerEvpayWebhookOnServer(botId);
  }

  return { success: true };
}

export async function updateBotAvatar(botId: string, avatarUrl: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { error } = await supabase
    .from("bots")
    .update({ avatar_url: avatarUrl || null })
    .eq("id", botId);

  if (error) throw new Error(`Failed to update avatar: ${error.message}`);
  return { success: true };
}

export async function toggleBlackEnabled(botId: string, enabled: boolean) {
  const admin = await isAdmin();
  if (!admin) throw new Error("Unauthorized: admin only");

  const supabase = await createClient();

  const { error } = await supabase
    .from("bots")
    .update({ black_enabled: enabled })
    .eq("id", botId);

  if (error) throw new Error(`Failed to toggle black: ${error.message}`);
  return { success: true };
}

export async function toggleProtectContent(botId: string, enabled: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { error } = await supabase
    .from("bots")
    .update({ protect_content: enabled })
    .eq("id", botId);

  if (error) throw new Error(`Failed to toggle protect_content: ${error.message}`);
  invalidateBotCache(botId);
  return { success: true };
}

/**
 * Apaga um bot permanentemente. Tira o webhook do Telegram antes (best-effort)
 * e depois deleta o registro — FKs com cascade limpam flows/leads/transactions/
 * blacklist/etc. Tenant precisa ser o dono (admins podem qualquer bot).
 */
export async function deleteBot(botId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  // Delega pro server (tem service role + lida com webhook do Telegram)
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const res = await fetch(`${serverUrl}/api/bots/${botId}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `delete failed (${res.status})`);
  }
  return { success: true };
}

/**
 * Substitui o token do Telegram do bot (ex: bot anterior foi banido, criou
 * outro no @BotFather e quer usar o token novo mantendo TODOS os leads,
 * transactions, flows, blacklist, etc.).
 *
 * Fluxo:
 * 1. Valida o token novo via getMe no Telegram
 * 2. Atualiza telegram_token + bot_username no DB
 * 3. Invalida o cache do server
 * 4. Re-registra o webhook (mesma URL, token novo)
 *
 * Leads e tudo mais ficam intactos — FK é por bot.id, não por token.
 *
 * Pra remarketing funcionar logo após a troca, os leads do bot antigo
 * precisam dar /start no bot NOVO pelo menos uma vez (Telegram bloqueia
 * envios pra users que nunca interagiram com o token novo).
 */
export async function updateBotToken(botId: string, newToken: string): Promise<{ success: true; bot_username: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const cleanToken = newToken.trim();
  if (!cleanToken.includes(":")) {
    throw new Error("Token inválido. Formato esperado: 123456:ABC-DEF...");
  }

  // Valida o token no Telegram
  const me = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
  const meData = await me.json();
  if (!meData.ok || !meData.result?.username) {
    throw new Error(meData.description || "Token rejeitado pelo Telegram.");
  }
  const newUsername = meData.result.username as string;

  // Atualiza DB
  const { error } = await supabase
    .from("bots")
    .update({ telegram_token: cleanToken, bot_username: newUsername })
    .eq("id", botId);
  if (error) throw new Error(`Failed to update token: ${error.message}`);

  invalidateBotCache(botId);

  // Re-registra webhook com o novo token (mesma URL final do bot)
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  await fetch(`${serverUrl}/api/bots/${botId}/register-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }).catch((e) => console.error("register-webhook after token update failed:", e));

  return { success: true, bot_username: newUsername };
}
