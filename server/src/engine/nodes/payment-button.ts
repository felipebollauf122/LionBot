import type { SupabaseClient } from "@supabase/supabase-js";
import type { NodeContext, NodeResult } from "../types.js";
import type { PaymentGateway } from "../../services/payment-gateway.js";
import { UtmifyService } from "../../services/utmify.js";
import { FacebookCapi } from "../../services/facebook-capi.js";
import { TrackingService } from "../../services/tracking-service.js";
import { addPaymentTimeoutJob } from "../../queue.js";
import { logEvent } from "../../services/lead-messages.js";

interface BundleProduct {
  id: string;
  name: string;
  description?: string | null;
  price: number; // cents
  currency: string;
  is_active: boolean;
  ghost_name: string | null;
  ghost_description: string | null;
  button_style: "danger" | "success" | "primary" | null;
}

interface BundleItem {
  id: string;
  product_id: string;
  sort_order: number;
  products: BundleProduct;
}

interface Bundle {
  id: string;
  name: string;
  ghost_name: string | null;
  message_text: string;
  is_active: boolean;
  product_bundle_items: BundleItem[];
}

export async function handlePaymentBundleNode(
  ctx: NodeContext,
  db: SupabaseClient,
  _gateway: PaymentGateway,
  _baseWebhookUrl: string,
): Promise<NodeResult> {
  const bundleId = String(ctx.node.data.bundle_id ?? "");

  if (!bundleId) {
    await ctx.telegram.sendMessage({
      chatId: ctx.chatId,
      text: "Erro: nenhum conjunto de produtos configurado.",
    });
    return { nextNodeId: null };
  }

  // Fetch bundle with products
  const { data: bundle, error } = await db
    .from("product_bundles")
    .select("id, name, ghost_name, message_text, is_active, product_bundle_items(id, product_id, sort_order, products(id, name, price, currency, is_active, ghost_name, ghost_description, button_style))")
    .eq("id", bundleId)
    .single();

  if (error || !bundle) {
    console.error(`[payment_button] Bundle not found: ${bundleId}`, error);
    await ctx.telegram.sendMessage({
      chatId: ctx.chatId,
      text: "Desculpe, os produtos estão indisponíveis no momento.",
    });
    return { nextNodeId: null };
  }

  const typedBundle = bundle as unknown as Bundle;

  // Filter only active products and sort
  const items = typedBundle.product_bundle_items
    .filter((item) => item.products && item.products.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (items.length === 0) {
    await ctx.telegram.sendMessage({
      chatId: ctx.chatId,
      text: "Desculpe, não há produtos disponíveis no momento.",
    });
    return { nextNodeId: null };
  }

  // Ghost name agora vale em qualquer fluxo (white e black). Se não está
  // preenchido, cai pro nome real. Único critério de visibilidade do
  // editor de ghost é admin (já enforced no front).
  // Build inline keyboard — one button per product with name + price.
  // Cada produto pode ter button_style ('danger', 'success', 'primary') que
  // colore o botão (Bot API 8.x+). Clientes Telegram antigos ignoram o campo
  // e mostram o botão na cor padrão — compatível.
  type InlineBtn = {
    text: string;
    callback_data: string;
    style?: "danger" | "success" | "primary";
  };

  // Botões de PRODUTO (clicar = "Aceitar" → gera PIX). Um por linha por padrão.
  const productButtons: InlineBtn[] = items.map((item) => {
    const product = item.products;
    // Cliente sempre vê o nome real. Ghost é só pra gateway (ver callback).
    const displayName = product.name;
    const priceInReais = product.price / 100;
    const priceFormatted = priceInReais.toLocaleString("pt-BR", {
      style: "currency",
      currency: product.currency,
    });
    const btn: InlineBtn = {
      text: `${displayName} por ${priceFormatted}`,
      callback_data: `pay:${product.id}`,
    };
    if (product.button_style) btn.style = product.button_style;
    return btn;
  });

  // UPSELL/DOWNSELL: o produto é o "Aceitar"; somamos um "Recusar" (handle
  // reject) + botões extras opcionais (handles btn_0, btn_1...). O usuário
  // define os rótulos e o layout (horizontal/vertical) no editor.
  const saleType = String(ctx.node.data.sale_type ?? "main");
  const isOffer = saleType === "upsell" || saleType === "downsell";
  const extraButtons: InlineBtn[] = [];
  if (isOffer) {
    const cfg = (Array.isArray(ctx.node.data.accept_reject_buttons)
      ? ctx.node.data.accept_reject_buttons
      : []) as { id?: string; label?: string }[];
    // padrão: se nada configurado, usa só "Recusar"
    const list = cfg.length > 0 ? cfg : [{ id: "reject", label: "Recusar" }];
    for (const b of list) {
      const id = String(b.id ?? "reject");
      const label = String(b.label ?? "Recusar");
      // o botão de produto já é o "accept"; ignoramos um eventual id "accept"
      if (id === "accept") continue;
      extraButtons.push({ text: label, callback_data: `${ctx.node.id}:${id}` });
    }
  }

  // Layout: vertical = um botão por linha; horizontal = todos na mesma linha.
  const layout = String(ctx.node.data.button_layout ?? "vertical");
  let inlineKeyboard: InlineBtn[][];
  if (isOffer && layout === "horizontal") {
    // produtos cada um na sua linha (preço longo), extras juntos numa linha
    inlineKeyboard = productButtons.map((b) => [b]);
    if (extraButtons.length > 0) inlineKeyboard.push(extraButtons);
  } else {
    // vertical (padrão): tudo empilhado
    inlineKeyboard = [...productButtons, ...extraButtons].map((b) => [b]);
  }

  // Send single message with header text + all product buttons
  const messageIds: number[] = [];
  const msg = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text: typedBundle.message_text,
    replyMarkup: { inline_keyboard: inlineKeyboard },
  });
  if (msg) messageIds.push(msg.message_id);

  // Fire view_offer → Facebook ViewContent
  const { data: botForTracking } = await db
    .from("bots")
    .select("facebook_pixel_id, facebook_access_token, facebook_pixel_id_backup, facebook_access_token_backup, facebook_backup_enabled, utmify_api_key")
    .eq("id", ctx.lead.bot_id)
    .single();

  if (botForTracking) {
    const fbCapi = new FacebookCapi(botForTracking.facebook_pixel_id ?? "", botForTracking.facebook_access_token ?? "", {
      pixelId: botForTracking.facebook_pixel_id_backup,
      accessToken: botForTracking.facebook_access_token_backup,
      enabled: botForTracking.facebook_backup_enabled,
    });
    const utmSvc = new UtmifyService(botForTracking.utmify_api_key ?? "");
    const trackingSvc = new TrackingService(db, fbCapi, utmSvc);
    trackingSvc.trackViewOffer({
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
      },
      // Bundle external label: ghost OU "Offer N" hash do id. NUNCA o nome real.
      contentName:
        typedBundle.ghost_name?.trim() ||
        `Offer ${(parseInt(typedBundle.id.replace(/-/g, "").slice(-1), 16) || 0) + 1}`,
    }).catch((e) => console.error("[tracking] Failed to track view_offer:", e));
  }

  // Save state: we're waiting for a product selection
  return {
    nextNodeId: "wait",
    messageIds: messageIds.length > 0 ? messageIds : undefined,
    stateUpdates: {
      pending_payment_node_id: ctx.node.id,
      pending_bundle_id: bundleId,
      awaiting_product_selection: true,
    },
  };
}

// Handle when user clicks a "pay" button — called from flow-processor
export async function handleProductPaymentCallback(
  ctx: NodeContext,
  db: SupabaseClient,
  gateway: PaymentGateway,
  baseWebhookUrl: string,
  productId: string,
  gatewayKind: "sigilopay" | "evpay" = "sigilopay",
): Promise<NodeResult> {
  // Fetch product
  const { data: product } = await db
    .from("products")
    .select("id, name, description, price, currency, is_active, ghost_name, ghost_description")
    .eq("id", productId)
    .single();

  if (!product) {
    await ctx.telegram.sendMessage({
      chatId: ctx.chatId,
      text: "Desculpe, este produto está indisponível.",
    });
    return { nextNodeId: "wait" };
  }

  const typedProduct = product as BundleProduct;
  // Cliente no chat vê nome real. TUDO QUE SAI PRA FORA (gateway, FB,
  // Utmify) usa ghost_name OU "Product N" — nunca o nome real. Mesmo
  // quando ghost vazio.
  const { productLabelForExternal, productDescriptionForExternal } = await import(
    "../../services/external-product-label.js"
  );
  const displayName = typedProduct.name;
  const gatewayName = productLabelForExternal(typedProduct);
  const gatewayDescription = productDescriptionForExternal(typedProduct);
  console.log(
    `[payment] gatewayName="${gatewayName}" gatewayDescription="${gatewayDescription ?? ""}" (ghost_name set=${!!typedProduct.ghost_name})`,
  );
  const identifier = `eaglebot_${ctx.lead.id}_${Date.now()}`;
  const amountInReais = typedProduct.price / 100;

  // Build client data from lead info (fallbacks are valid test values)
  const clientEmail = String(ctx.lead.state.email ?? `${ctx.lead.telegram_user_id}@eaglebot.temp`);
  const clientPhone = String(ctx.lead.state.phone ?? "11999999999");
  const clientDocument = String(ctx.lead.state.document ?? "52998224725");

  // Webhook callback (sigilopay manda no body da request; evpay tem webhook
  // pré-registrado no projeto e ignora callbackUrl no payload do payment).
  const callbackUrl =
    gatewayKind === "evpay"
      ? `${baseWebhookUrl}/webhook/evpay`
      : `${baseWebhookUrl}/webhook/payment`;

  // Instant feedback — send before generating pix (fire-and-forget)
  const loadingMsg = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text: "⏳ Gerando seu Pix, aguarde...",
  });

  const gatewayParams = {
    identifier,
    amount: amountInReais,
    clientName: ctx.lead.first_name,
    clientEmail,
    clientPhone,
    clientDocument,
    products: [
      {
        id: typedProduct.id,
        name: gatewayName,
        description: gatewayDescription,
        quantity: 1,
        price: amountInReais,
      },
    ],
    callbackUrl,
    metadata: {
      provider: "eaglebot",
      orderId: identifier,
      lead_id: ctx.lead.id,
      bot_id: ctx.lead.bot_id,
      flow_id: ctx.lead.current_flow_id ?? "",
    },
  };

  console.log(
    `[gateway-call] kind=${gatewayKind} productId=${typedProduct.id} ghost_name="${typedProduct.ghost_name ?? ""}" ghost_description="${typedProduct.ghost_description ?? ""}" → sending:`,
    JSON.stringify(gatewayParams, null, 2),
  );

  let payment;
  try {
    payment = await gateway.createPixPayment(gatewayParams);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[payment] ${gatewayKind} failed for product ${productId}, lead ${ctx.lead.id}:`, errorMsg);
    // Delete loading message on error
    if (loadingMsg) {
      ctx.telegram.deleteMessage(ctx.chatId, loadingMsg.message_id).catch(() => {});
    }
    // Strip any HTML/tags and cap length to avoid Telegram parse errors
    const safeMsg = errorMsg.replace(/<[^>]*>/g, "").replace(/[<>&]/g, "").slice(0, 200);
    await ctx.telegram.sendMessage({
      chatId: ctx.chatId,
      text: `⚠️ Erro no pagamento: ${safeMsg}`,
    });
    return { nextNodeId: "wait" };
  }

  // Create transaction record. flow_id pode ser null (ex: pagamento gerado
  // dentro de um flow de remarketing, que não está em `flows`).
  const { data: txRecord } = await db.from("transactions").insert({
    tenant_id: ctx.lead.tenant_id,
    lead_id: ctx.lead.id,
    bot_id: ctx.lead.bot_id,
    flow_id: ctx.lead.current_flow_id ?? null,
    product_id: typedProduct.id,
    gateway: gatewayKind,
    external_id: payment.transactionId,
    amount: typedProduct.price,
    currency: typedProduct.currency,
    status: "pending",
    // tipo de venda marcado no nó de pagamento (Análises): main/upsell/downsell/orderbump
    sale_type: String(ctx.node.data.sale_type ?? "main"),
  }).select("id").single();

  // Marco na timeline do chat (aba Clientes): PIX gerado. Fire-and-forget.
  logEvent(
    {
      leadId: ctx.lead.id,
      botId: ctx.lead.bot_id,
      tenantId: ctx.lead.tenant_id,
    },
    "pix_generated",
    `PIX gerado: ${typedProduct.name}`,
    { amount: typedProduct.price, product_name: typedProduct.name },
  );

  // Fire checkout (Facebook InitiateCheckout) + Utmify waiting_payment
  const { data: botConfig } = await db
    .from("bots")
    .select("facebook_pixel_id, facebook_access_token, facebook_pixel_id_backup, facebook_access_token_backup, facebook_backup_enabled, utmify_api_key")
    .eq("id", ctx.lead.bot_id)
    .single();

  if (botConfig) {
    const fbCapi = new FacebookCapi(botConfig.facebook_pixel_id ?? "", botConfig.facebook_access_token ?? "", {
      pixelId: botConfig.facebook_pixel_id_backup,
      accessToken: botConfig.facebook_access_token_backup,
      enabled: botConfig.facebook_backup_enabled,
    });
    const utmSvc = new UtmifyService(botConfig.utmify_api_key ?? "");
    const trackingSvc = new TrackingService(db, fbCapi, utmSvc);

    const leadInfo = {
      id: ctx.lead.id,
      tid: ctx.lead.tid,
      fbclid: ctx.lead.fbclid,
      firstName: ctx.lead.first_name,
      lastName: ctx.lead.last_name ?? undefined,
      email: clientEmail,
      phone: clientPhone,
      utmSource: ctx.lead.utm_source ?? undefined,
      utmMedium: ctx.lead.utm_medium ?? undefined,
      utmCampaign: ctx.lead.utm_campaign ?? undefined,
      utmContent: ctx.lead.utm_content ?? undefined,
      utmTerm: ctx.lead.utm_term ?? undefined,
      telegramUserId: ctx.lead.telegram_user_id,
      botId: ctx.lead.bot_id,
    };

    // Facebook InitiateCheckout event — usa GHOST (mesma regra da gateway:
    // tudo que sai pra fora do nosso sistema usa ghost, fallback pro real).
    trackingSvc.trackCheckout({
      tenantId: ctx.lead.tenant_id,
      leadId: ctx.lead.id,
      botId: ctx.lead.bot_id,
      amount: typedProduct.price,
      currency: typedProduct.currency,
      lead: leadInfo,
      productId: typedProduct.id,
      productName: gatewayName,
    }).catch((e) => console.error("[tracking] Failed to track checkout:", e));

    // Utmify waiting_payment — também ghost
    if (botConfig.utmify_api_key) {
      utmSvc.sendOrder({
        orderId: txRecord?.id ?? payment.transactionId,
        status: "waiting_payment",
        platform: "eaglebot",
        paymentMethod: "pix",
        customer: {
          name: ctx.lead.first_name,
          email: clientEmail,
          phone: clientPhone,
          document: clientDocument,
        },
        products: [{
          id: typedProduct.id,
          name: gatewayName,
          priceInCents: String(typedProduct.price),
          quantity: 1,
        }],
        trackingParameters: {
          src: ctx.lead.tid ?? null,
          sck: ctx.lead.fbclid ?? null,
          utm_source: ctx.lead.utm_source ?? undefined,
          utm_medium: ctx.lead.utm_medium ?? undefined,
          utm_campaign: ctx.lead.utm_campaign ?? undefined,
          utm_content: ctx.lead.utm_content ?? undefined,
          utm_term: ctx.lead.utm_term ?? undefined,
        },
      }).catch((e) => console.error("[utmify] Failed to send waiting_payment:", e));
    }
  }

  const priceFormatted = amountInReais.toLocaleString("pt-BR", {
    style: "currency",
    currency: typedProduct.currency,
  });

  console.log(`[payment] pixImage from SigiloPay: ${payment.pixImage ?? "null"}`);

  // Generate QR code URL from pix code if SigiloPay didn't provide one
  const qrCodeUrl = payment.pixImage
    || `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(payment.pixCode)}`;

  // Delete loading message now that pix is ready
  if (loadingMsg) {
    ctx.telegram.deleteMessage(ctx.chatId, loadingMsg.message_id).catch(() => {});
  }

  // Send payment details with QR Code button
  const paymentMsg = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text: [
      `🌟 Você selecionou o seguinte plano:`,
      ``,
      `🎁 Plano: ${displayName}`,
      `💰 Valor: ${priceFormatted}`,
      ``,
      `💳 Total: ${priceFormatted}`,
      ``,
      `💠 Pague via Pix Copia e Cola:`,
      ``,
      `<code>${payment.pixCode}</code>`,
      ``,
      `👆 Toque no código acima para copiá-lo`,
      ``,
      `‼️ Após o pagamento seu acesso será liberado automaticamente.`,
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [{ text: "📋 Copiar código Pix", copy_text: { text: payment.pixCode } }],
        [{ text: "📱 Ver QR Code", callback_data: `qrcode:${ctx.node.id}` }],
      ],
    },
  });

  // Schedule payment timeout — fires "not_paid" edge if payment not confirmed in time
  const timeoutMinutes = Number(ctx.node.data.payment_timeout_minutes ?? 15);
  if (timeoutMinutes > 0 && ctx.lead.current_flow_id) {
    addPaymentTimeoutJob(
      {
        leadId: ctx.lead.id,
        flowId: ctx.lead.current_flow_id,
        paymentNodeId: ctx.node.id,
        externalTransactionId: payment.transactionId,
        botId: ctx.lead.bot_id,
        tenantId: ctx.lead.tenant_id,
        chatId: ctx.chatId,
      },
      timeoutMinutes * 60,
    ).catch((e) => console.error("[payment] Failed to schedule timeout:", e));
  }

  return {
    nextNodeId: "wait",
    messageIds: paymentMsg ? [paymentMsg.message_id] : undefined,
    stateUpdates: {
      pending_transaction_id: payment.transactionId,
      pending_payment_node_id: ctx.node.id,
      pending_identifier: identifier,
      pending_pix_code: payment.pixCode,
      pending_pix_image: qrCodeUrl,
      awaiting_product_selection: false,
    },
  };
}
