import type { SupabaseClient } from "@supabase/supabase-js";
import type { NodeContext, NodeResult } from "../types.js";
import type { InlineKeyboardButton, InlineKeyboardButtonStyle } from "../../telegram/api.js";
import { FacebookCapi } from "../../services/facebook-capi.js";
import { TiktokEvents } from "../../services/tiktok-events.js";
import { UtmifyService } from "../../services/utmify.js";
import { TrackingService } from "../../services/tracking-service.js";
import { productLabelForExternal } from "../../services/external-product-label.js";
import { botCache } from "../../cache.js";

/** Colunas do bot usadas só pra tracking (FB CAPI / TikTok / Utmify) — mesmo
 *  shape usado em payment-button.ts. */
interface BotTrackingConfig {
  facebook_pixel_id: string | null;
  facebook_access_token: string | null;
  facebook_pixel_id_backup: string | null;
  facebook_access_token_backup: string | null;
  facebook_backup_enabled: boolean | null;
  tiktok_pixel_id: string | null;
  tiktok_access_token: string | null;
  utmify_api_key: string | null;
}

export async function handleButtonNode(ctx: NodeContext, db?: SupabaseClient): Promise<NodeResult> {
  const text = String(ctx.node.data.text ?? "");
  const buttons = (ctx.node.data.buttons ?? []) as Array<{
    id?: string;
    text: string;
    action: string;
    value: string;
    product_id?: string;
    style?: InlineKeyboardButtonStyle;
  }>;

  const inlineKeyboard: InlineKeyboardButton[][] = buttons.map((btn, i) => {
    const style = btn.style || undefined;
    if (btn.action === "open_url") {
      return [{ text: btn.text, url: btn.value, style }];
    }
    if (btn.action === "payment") {
      // callback carrega só o id do botão — o produto é resolvido no
      // servidor a partir da config viva do nó (flow-processor.ts), nunca
      // confiado direto do cliente.
      const btnId = btn.id ?? `btn_idx_${i}`;
      return [{ text: btn.text, callback_data: `${ctx.node.id}:${btnId}`, style }];
    }
    return [{ text: btn.text, callback_data: `${ctx.node.id}:${btn.value}`, style }];
  });

  const sent = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text,
    replyMarkup: { inline_keyboard: inlineKeyboard },
  });

  // ViewContent: até esta correção, só o nó "payment_button" dedicado
  // (bundle) disparava esse evento — um botão de pagamento inline avulso
  // dentro de um nó "button" comum (padrão comum de upsell/downsell simples)
  // nunca gerava ViewContent, só Contact e (se o lead clicasse)
  // InitiateCheckout/Purchase, distorcendo a razão ViewContent→
  // InitiateCheckout que a otimização de campanha da TikTok usa.
  if (db) {
    const productIds = Array.from(
      new Set(
        buttons
          .filter((b) => b.action === "payment" && b.product_id)
          .map((b) => String(b.product_id)),
      ),
    );
    if (productIds.length > 0) {
      void trackButtonViewOffers(db, ctx, productIds);
    }
  }

  return {
    nextNodeId: "wait",
    messageIds: sent ? [sent.message_id] : undefined,
  };
}

/** Dispara ViewContent (Facebook + TikTok) pra cada produto oferecido por um
 *  botão action:"payment" deste nó — fire-and-forget, nunca bloqueia o envio
 *  da mensagem nem o retorno do nó. */
async function trackButtonViewOffers(db: SupabaseClient, ctx: NodeContext, productIds: string[]): Promise<void> {
  try {
    const botConfig = (botCache.get(ctx.lead.bot_id) as BotTrackingConfig | undefined)
      ?? ((
          await db
            .from("bots")
            .select("facebook_pixel_id, facebook_access_token, facebook_pixel_id_backup, facebook_access_token_backup, facebook_backup_enabled, tiktok_pixel_id, tiktok_access_token, utmify_api_key")
            .eq("id", ctx.lead.bot_id)
            .single()
        ).data as BotTrackingConfig | null);
    if (!botConfig) return;

    const { data: products } = await db
      .from("products")
      .select("id, name, ghost_name")
      .in("id", productIds);
    if (!products?.length) return;

    const fbCapi = new FacebookCapi(botConfig.facebook_pixel_id ?? "", botConfig.facebook_access_token ?? "", {
      pixelId: botConfig.facebook_pixel_id_backup,
      accessToken: botConfig.facebook_access_token_backup,
      enabled: botConfig.facebook_backup_enabled,
    });
    const tiktokEvents = new TiktokEvents(botConfig.tiktok_pixel_id ?? "", botConfig.tiktok_access_token ?? "", ctx.lead.bot_id);
    const utmSvc = new UtmifyService(botConfig.utmify_api_key ?? "");
    const trackingSvc = new TrackingService(db, fbCapi, utmSvc, tiktokEvents);

    for (const product of products as Array<{ id: string; name: string; ghost_name: string | null }>) {
      await trackingSvc.trackViewOffer({
        tenantId: ctx.lead.tenant_id,
        leadId: ctx.lead.id,
        botId: ctx.lead.bot_id,
        lead: {
          id: ctx.lead.id,
          tid: ctx.lead.tid,
          fbclid: ctx.lead.fbclid,
          firstName: ctx.lead.first_name,
          lastName: ctx.lead.last_name ?? undefined,
          utmSource: ctx.lead.utm_source ?? undefined,
          utmMedium: ctx.lead.utm_medium ?? undefined,
          utmCampaign: ctx.lead.utm_campaign ?? undefined,
          utmContent: ctx.lead.utm_content ?? undefined,
          utmTerm: ctx.lead.utm_term ?? undefined,
          telegramUserId: ctx.lead.telegram_user_id,
          botId: ctx.lead.bot_id,
        },
        // NUNCA o nome real pra fora — ghost OU "Product N" (mesma regra de
        // payment-button.ts/handleProductPaymentCallback).
        contentName: productLabelForExternal(product),
      });
    }
  } catch (e) {
    console.error("[tracking] Failed to track view_offer (button node):", e);
  }
}
