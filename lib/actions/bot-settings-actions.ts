"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { invalidateBotCache } from "@/lib/actions/cache-actions";
import { GATEWAYS, NOWPAYMENTS_CURRENCIES, type GatewayKind } from "@/lib/gateways";

interface BotSettings {
  facebook_pixel_id: string;
  facebook_access_token: string;
  facebook_pixel_id_backup: string;
  facebook_access_token_backup: string;
  facebook_backup_enabled: boolean;
  tiktok_pixel_id: string;
  tiktok_access_token: string;
  tiktok_test_event_code: string;
  utmify_api_key: string;
  /** Gateway PADRÃO — usado quando o nó de pagamento não escolhe nenhum. */
  payment_gateway: GatewayKind;
  /** Todos os gateways que este bot pode usar (escolhidos por nó no fluxo). */
  enabled_gateways: GatewayKind[];
  sigilopay_public_key: string;
  sigilopay_secret_key: string;
  evpay_api_key: string;
  evpay_project_id: string;
  zuckpay_client_id: string;
  zuckpay_client_secret: string;
  nowpayments_api_key: string;
  nowpayments_ipn_secret_key: string;
  nowpayments_pay_currency: string;
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

/**
 * Credencial só conta se tiver conteúdo de verdade. String só de espaços é
 * truthy, passava batido pelo `|| null` e virava credencial "configurada": o
 * isConfigured() do servidor devolvia true e disparava chamada de API com lixo
 * (no EvPay chegava a registrar webhook). Trim antes de decidir o null.
 */
function cleanCredential(value: string | null | undefined): string | null {
  return value?.trim() || null;
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

  // Guardadas fora do update porque o registro do webhook lá embaixo precisa
  // decidir em cima do valor já limpo, não do que veio do form.
  const evpayApiKey = cleanCredential(settings.evpay_api_key);
  const evpayProjectId = cleanCredential(settings.evpay_project_id);

  // Configuração PARCIAL do TikTok (só pixel OU só token) sempre foi erro de
  // operador (colou errado, apagou um campo) — mas ficava muda pra sempre: o
  // isConfigured() do servidor só dava console.warn, inacessível pra quem
  // está no dashboard. Barra aqui, com uma mensagem que o form já sabe exibir.
  const tiktokPixelId = cleanCredential(settings.tiktok_pixel_id);
  const tiktokAccessToken = cleanCredential(settings.tiktok_access_token);
  if (Boolean(tiktokPixelId) !== Boolean(tiktokAccessToken)) {
    throw new Error(
      "TikTok: preencha Pixel ID e Access Token juntos, ou deixe os dois vazios — configuração parcial não envia eventos.",
    );
  }

  // Mesma lista que o <select> do form oferece — barra aqui pra não mandar um
  // pay_currency inválido pra API da NOWPayments (o form já restringe, mas
  // uma chamada direta ou dado legado poderia burlar isso).
  const nowpaymentsPayCurrency = settings.nowpayments_pay_currency || "usdttrc20";
  if (!NOWPAYMENTS_CURRENCIES.some((c) => c.value === nowpaymentsPayCurrency)) {
    throw new Error(`NOWPayments: moeda "${nowpaymentsPayCurrency}" não suportada.`);
  }

  // ── Gateways ativos ────────────────────────────────────────────────────
  // Credenciais já limpas, num mapa por coluna, pra validar "ativo tem
  // credencial?" sem repetir o nome de cada campo aqui (GATEWAYS.requiredFields
  // é a fonte).
  const credentials: Record<string, string | null> = {
    sigilopay_public_key: cleanCredential(settings.sigilopay_public_key),
    sigilopay_secret_key: cleanCredential(settings.sigilopay_secret_key),
    evpay_api_key: evpayApiKey,
    evpay_project_id: evpayProjectId,
    zuckpay_client_id: cleanCredential(settings.zuckpay_client_id),
    zuckpay_client_secret: cleanCredential(settings.zuckpay_client_secret),
    nowpayments_api_key: cleanCredential(settings.nowpayments_api_key),
    nowpayments_ipn_secret_key: cleanCredential(settings.nowpayments_ipn_secret_key),
  };

  const enabledGateways = (settings.enabled_gateways ?? []).filter((kind) =>
    GATEWAYS.some((g) => g.kind === kind),
  );
  if (enabledGateways.length === 0) {
    throw new Error("Ative pelo menos um gateway de pagamento.");
  }

  // Ativo sem credencial completa = cobrança falhando na cara do lead com um
  // erro cru do gateway. Barra no salvamento, onde dá pra explicar.
  for (const kind of enabledGateways) {
    const meta = GATEWAYS.find((g) => g.kind === kind);
    if (!meta) continue;
    const missing = meta.requiredFields.filter((f) => !credentials[f]);
    if (missing.length > 0) {
      throw new Error(
        `${meta.label}: está ativo mas faltam credenciais. Preencha os campos ou desative o gateway.`,
      );
    }
  }

  // O padrão TEM que estar entre os ativos — senão todo nó de pagamento sem
  // gateway escolhido cairia num gateway desligado.
  if (!enabledGateways.includes(settings.payment_gateway)) {
    const label = GATEWAYS.find((g) => g.kind === settings.payment_gateway)?.label
      ?? settings.payment_gateway;
    throw new Error(`O gateway padrão (${label}) precisa estar ativo.`);
  }

  const { error } = await supabase
    .from("bots")
    .update({
      facebook_pixel_id: cleanCredential(settings.facebook_pixel_id),
      facebook_access_token: cleanCredential(settings.facebook_access_token),
      facebook_pixel_id_backup: cleanCredential(settings.facebook_pixel_id_backup),
      facebook_access_token_backup: cleanCredential(settings.facebook_access_token_backup),
      facebook_backup_enabled: settings.facebook_backup_enabled,
      tiktok_pixel_id: tiktokPixelId,
      tiktok_access_token: tiktokAccessToken,
      tiktok_test_event_code: cleanCredential(settings.tiktok_test_event_code),
      utmify_api_key: cleanCredential(settings.utmify_api_key),
      payment_gateway: settings.payment_gateway,
      enabled_gateways: enabledGateways,
      ...credentials,
      nowpayments_pay_currency: nowpaymentsPayCurrency,
      collect_email_after_payment: settings.collect_email_after_payment,
      email_request_message: settings.email_request_message || null,
      tracking_mode: settings.tracking_mode,
      prelander_headline: settings.prelander_headline || null,
      prelander_description: settings.prelander_description || null,
      // .trim() (não só || null): "   " é truthy e sobrevivia como src="   " —
      // o browser resolve isso pra URL da própria página e baixa o HTML como
      // se fosse imagem. Os outros campos de texto livre aqui são só exibição,
      // sem esse efeito colateral (#credential-hygiene).
      prelander_image_url: settings.prelander_image_url?.trim() || null,
      prelander_cta_text: settings.prelander_cta_text || null,
      redirect_display_name: settings.redirect_display_name || null,
      tracking_page_intro: settings.tracking_page_intro || null,
    })
    .eq("id", botId);

  if (error) throw new Error(`Failed to save settings: ${error.message}`);
  invalidateBotCache(botId);

  // Se o gateway é EvPay e tem credenciais, manda o server registrar o webhook.
  // Checa os valores limpos: com o form cru, credencial só de espaço era truthy
  // e mandava o server registrar webhook com credencial vazia no banco.
  // Condição é ATIVO (não "é o padrão"): com multi-gateway o EvPay pode ser
  // usado só por um nó do fluxo sem ser o padrão do bot, e nesse caso ele
  // ainda precisa do webhook registrado — senão as cobranças desse nó nunca
  // seriam confirmadas.
  if (enabledGateways.includes("evpay") && evpayApiKey && evpayProjectId) {
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

  // Sem isso o server não enxergava a troca até o TTL de 10 min expirar —
  // era por isso que resolveFlowName relia black_enabled do banco em TODO
  // /start. Com a invalidação aqui, o cache passa a ser confiável.
  //
  // Este é um interruptor de segurança: awaited e VERIFICADO. Se a
  // invalidação não chegar ao servidor, o banco já está atualizado mas o
  // engine seguiria com o valor antigo por até 10 min — então falhamos alto
  // pra quem clicou saber que precisa repetir, em vez de mentir "salvo".
  const invalidated = await invalidateBotCache(botId);
  if (!invalidated) {
    throw new Error(
      "Configuração salva no banco, mas o servidor do bot não confirmou a atualização. " +
        "A mudança pode levar até 10 minutos pra valer. Verifique se o servidor está no ar e tente de novo.",
    );
  }
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
