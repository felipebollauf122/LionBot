import type { SupabaseClient } from "@supabase/supabase-js";
import type { NodeContext, NodeResult } from "../types.js";
import { pickRandomIndex } from "./variant-pick.js";
import type { PaymentGateway } from "../../services/payment-gateway.js";
import { UtmifyService } from "../../services/utmify.js";
import { FacebookCapi } from "../../services/facebook-capi.js";
import { TiktokEvents } from "../../services/tiktok-events.js";
import { TrackingService } from "../../services/tracking-service.js";
import { addPaymentTimeoutJob } from "../../queue.js";
import { logEvent } from "../../services/lead-messages.js";
import { botCache } from "../../cache.js";

/** Colunas do bot usadas só pra tracking (FB CAPI / TikTok / Utmify). */
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
  // Randomização de preço/oferta: sorteia 1 de N bundles configurados
  // (biblioteca de remarketing) em vez do bundle_id fixo. Sem lista
  // configurada (ou randomize_price desligado), cai no campo fixo de sempre.
  let bundleId = String(ctx.node.data.bundle_id ?? "");
  if (ctx.node.data.randomize_price === true) {
    const candidates = (Array.isArray(ctx.node.data.bundle_ids) ? ctx.node.data.bundle_ids : [])
      .map((id) => String(id))
      .filter((id) => id.length > 0);
    if (candidates.length > 0) {
      bundleId = candidates[pickRandomIndex(candidates.length)];
    }
  }

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

  // ATENÇÃO: o nome REAL (product.name) só pode aparecer no TELEGRAM do cliente
  // (botões/mensagens). Pra QUALQUER saída externa (gateway PIX, Facebook CAPI,
  // Utmify) usa-se SEMPRE productLabelForExternal/gatewayName → ghost OU genérico
  // ("Product N"), NUNCA o nome real, mesmo com ghost vazio. Não introduza
  // fallback `ghost || name` em saída externa — vaza o nome e bane criativo.
  // Build inline keyboard — one button per product with name + price.
  // Cada produto pode ter button_style ('danger', 'success', 'primary') que
  // colore o botão (Bot API 8.x+). Clientes Telegram antigos ignoram o campo
  // e mostram o botão na cor padrão — compatível.
  type InlineBtn = {
    text: string;
    callback_data?: string;
    url?: string;
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

  // Botões extras (qualquer tipo de venda) — configurados livremente no
  // editor, sempre aparecem embaixo dos preços. "link" abre uma URL direto
  // (sem passar pelo fluxo, sem callback nenhum — o Telegram cuida sozinho);
  // "flow" vira um handle próprio no nó (ver payment-button-node.tsx), roteado
  // pelo mesmo mecanismo genérico "${nodeId}:${id}" que já roteia Recusar/
  // extras de upsell-downsell (FlowProcessor.handleCallbackQuery, sem
  // allowlist de ids — qualquer id com uma edge correspondente funciona).
  const customButtonsCfg = (Array.isArray(ctx.node.data.custom_buttons)
    ? ctx.node.data.custom_buttons
    : []) as { id?: string; label?: string; kind?: string; url?: string }[];
  const customButtons: InlineBtn[] = [];
  for (const b of customButtonsCfg) {
    const label = String(b.label ?? "").trim();
    if (!label) continue;
    if (b.kind === "link") {
      const url = String(b.url ?? "").trim();
      if (!url) continue; // sem URL configurada — não manda um botão quebrado
      customButtons.push({ text: label, url });
    } else {
      const id = String(b.id ?? "").trim();
      if (!id) continue;
      customButtons.push({ text: label, callback_data: `${ctx.node.id}:${id}` });
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
  // Botões extras sempre em suas próprias linhas, depois de tudo — ficam
  // "embaixo dos preços" independente do layout escolhido acima.
  if (customButtons.length > 0) inlineKeyboard.push(...customButtons.map((b) => [b]));

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
    .select("facebook_pixel_id, facebook_access_token, facebook_pixel_id_backup, facebook_access_token_backup, facebook_backup_enabled, tiktok_pixel_id, tiktok_access_token, utmify_api_key")
    .eq("id", ctx.lead.bot_id)
    .single();

  if (botForTracking) {
    const fbCapi = new FacebookCapi(botForTracking.facebook_pixel_id ?? "", botForTracking.facebook_access_token ?? "", {
      pixelId: botForTracking.facebook_pixel_id_backup,
      accessToken: botForTracking.facebook_access_token_backup,
      enabled: botForTracking.facebook_backup_enabled,
    });
    const tiktokEvents = new TiktokEvents(botForTracking.tiktok_pixel_id ?? "", botForTracking.tiktok_access_token ?? "", ctx.lead.bot_id);
    const utmSvc = new UtmifyService(botForTracking.utmify_api_key ?? "");
    const trackingSvc = new TrackingService(db, fbCapi, utmSvc, tiktokEvents);
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
        // (#B5) sem isso, buildExternalIds só tem lead.id pra montar
        // external_id do TikTok ViewContent — perde os vetores extra que
        // trackPurchase/trackCheckout já mandam.
        telegramUserId: ctx.lead.telegram_user_id,
        botId: ctx.lead.bot_id,
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
      // Sempre explícito (mesmo null) — limpa a atribuição de remarketing de
      // uma oferta anterior pra não vazar num pagamento de outra origem
      // (mesma disciplina de pending_payment_button_id no callback abaixo).
      // As duas chaves viajam sempre JUNTAS: numa execução de remarketing de
      // verdade (ctx.remarketingFlowId setado), flow-processor.ts sobrescreve
      // ambas com os valores corretos logo depois que este nó retorna (bloco
      // `!persistPosition`, nextNodeId==="wait"). Num flow REGULAR esse bloco
      // não roda, então é esta linha que precisa zerar send_id — sem ela ele
      // nunca era limpo em lugar nenhum e ficava preso no lead.state, herdado
      // por um pagamento futuro não relacionado (transactions.remarketing_send_id
      // não-nulo com remarketing_flow_id nulo — dado incoerente).
      pending_remarketing_flow_id: ctx.remarketingFlowId ?? null,
      pending_remarketing_send_id: null,
    },
    // bundleId é reportado sempre (randomizado ou fixo) — é um eixo de stats
    // válido de qualquer forma; ver remarketing_variant_sends.
    variantChoice: { bundleId },
  };
}

// Handle when user clicks a "pay" button — called from flow-processor
export async function handleProductPaymentCallback(
  ctx: NodeContext,
  db: SupabaseClient,
  gateway: PaymentGateway,
  baseWebhookUrl: string,
  productId: string,
  gatewayKind: "sigilopay" | "evpay" | "zuckpay" | "nowpayments" = "sigilopay",
  paymentButtonId?: string,
  remarketingFlowId?: string | null,
  remarketingSendId?: string | null,
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

  // Webhook callback:
  //  - sigilopay: manda no body da request → /webhook/payment
  //  - evpay: webhook pré-registrado no projeto (ignora callbackUrl)  → /webhook/evpay
  //  - zuckpay: manda no body (urlnoty) e assina HMAC → /webhook/zuckpay
  //  - nowpayments: manda em ipn_callback_url e assina HMAC (x-nowpayments-sig) → /webhook/nowpayments
  const callbackUrl =
    gatewayKind === "evpay"
      ? `${baseWebhookUrl}/webhook/evpay`
      : gatewayKind === "zuckpay"
        ? `${baseWebhookUrl}/webhook/zuckpay`
        : gatewayKind === "nowpayments"
          ? `${baseWebhookUrl}/webhook/nowpayments`
          : `${baseWebhookUrl}/webhook/payment`;

  // Instant feedback — dispara JÁ, sem await: a chamada ao gateway começa
  // no mesmo tick. Antes isso era awaited, serializando um round-trip do
  // Telegram (~150-500ms) na frente de toda geração de PIX.
  const loadingMsgPromise = ctx.telegram
    .sendMessage({
      chatId: ctx.chatId,
      text: "⏳ Gerando seu Pix, aguarde...",
    })
    .catch((err: unknown) => {
      // Antes esse envio era awaited, então uma falha aqui (bot bloqueado,
      // chat inexistente) abortava ANTES de criar cobrança no gateway. Agora
      // ele corre em paralelo, então a cobrança pode nascer órfã — raro, já
      // que o lead acabou de clicar num botão, mas precisa ser rastreável.
      console.warn(
        `[payment] mensagem de carregamento falhou p/ chat ${ctx.chatId} (lead ${ctx.lead.id}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
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
    loadingMsgPromise
      .then((m) => {
        if (m) ctx.telegram.deleteMessage(ctx.chatId, m.message_id).catch(() => {});
      })
      .catch(() => {});
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
  //
  // PERF: o insert viaja em paralelo com o envio da mensagem do PIX logo
  // abaixo — nada aqui é necessário pra montar essa mensagem, e antes o
  // cliente esperava esse round-trip (+ o refetch de `bots`) só pra ver o
  // código que o gateway já tinha devolvido.
  //
  // O Promise.resolve() NÃO é decorativo: PostgrestBuilder é um thenable
  // PREGUIÇOSO — a request só é disparada quando alguém chama .then(). Sem
  // isso o insert não sairia daqui, e se o envio abaixo lançasse a linha
  // NUNCA seria gravada: cobrança viva no gateway sem transação no banco,
  // e o webhook de confirmação não teria o que creditar.
  const txInsertPromise = Promise.resolve(db.from("transactions").insert({
    tenant_id: ctx.lead.tenant_id,
    lead_id: ctx.lead.id,
    bot_id: ctx.lead.bot_id,
    flow_id: ctx.lead.current_flow_id ?? null,
    // Atribuição de remarketing: current_flow_id nunca aponta pro flow de
    // remarketing (persistPosition=false em executeFlow), então essa é a
    // única forma de ligar a compra de volta ao flow/envio que a gerou.
    remarketing_flow_id: remarketingFlowId ?? null,
    remarketing_send_id: remarketingSendId ?? null,
    product_id: typedProduct.id,
    gateway: gatewayKind,
    external_id: payment.transactionId,
    amount: typedProduct.price,
    currency: typedProduct.currency,
    status: "pending",
    // tipo de venda marcado no nó de pagamento (Análises): main/upsell/downsell/orderbump
    sale_type: String(ctx.node.data.sale_type ?? "main"),
  }).select("id").single());

  // Marco na timeline do chat (aba Clientes): cobrança gerada. Fire-and-forget.
  // Reaproveita a chave de evento "pix_generated" (tem CHECK constraint no
  // banco, ver 038_lead_messages.sql — criar um valor novo pediria migration
  // própria) mesmo pra cripto; só o texto muda.
  logEvent(
    {
      leadId: ctx.lead.id,
      botId: ctx.lead.bot_id,
      tenantId: ctx.lead.tenant_id,
    },
    "pix_generated",
    gatewayKind === "nowpayments"
      ? `Cobrança cripto gerada: ${typedProduct.name}`
      : `PIX gerado: ${typedProduct.name}`,
    { amount: typedProduct.price, product_name: typedProduct.name },
  );

  const priceFormatted = amountInReais.toLocaleString("pt-BR", {
    style: "currency",
    currency: typedProduct.currency,
  });

  // Generate QR code URL from pix code if SigiloPay didn't provide one
  const qrCodeUrl = payment.pixImage
    || `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(payment.pixCode)}`;

  // Delete loading message now that pix is ready
  loadingMsgPromise
    .then((m) => {
      if (m) ctx.telegram.deleteMessage(ctx.chatId, m.message_id).catch(() => {});
    })
    .catch(() => {});

  // Send payment details with QR Code button — PRIMEIRA coisa depois do
  // gateway responder. Tracking (FB/Utmify) roda depois, sem segurar o user.
  //
  // try/finally: a cobrança JÁ existe no gateway neste ponto. Se o envio
  // falhar (bot bloqueado, chat inexistente, timeout da Telegram), a linha
  // em `transactions` ainda PRECISA ser gravada — senão o cliente que pagar
  // pelo código que chegou a aparecer nunca é creditado pelo webhook.
  let txRecord: { id: string } | null = null;
  let paymentMsg: Awaited<ReturnType<typeof ctx.telegram.sendMessage>> = null;
  // Cripto (NOWPayments) mostra endereço + valor exato na moeda escolhida,
  // em vez do código Pix copia-e-cola — a mecânica de copiar/QR é a mesma,
  // só reaproveitando pixCode=endereço e o mesmo fallback de QR acima.
  const isCrypto = gatewayKind === "nowpayments";
  const cryptoCurrency = (payment.payCurrency ?? "").toUpperCase();
  const cryptoAmountLine = payment.payAmount
    ? `${payment.payAmount}${cryptoCurrency ? ` ${cryptoCurrency}` : ""}`
    : cryptoCurrency || "valor exato exibido no gateway";
  // Só a seção de instrução de pagamento e a linha de fechamento variam por
  // gateway — o resto da mensagem (cabeçalho/plano/valor) é compartilhado,
  // pra não ter dois templates quase-idênticos divergindo com o tempo.
  const paymentInstructionLines = isCrypto
    ? [
        `💠 Envie exatamente <b>${cryptoAmountLine}</b>${payment.network ? ` (rede ${payment.network})` : ""} para o endereço abaixo:`,
        ``,
        `<code>${payment.pixCode}</code>`,
        ``,
        `👆 Toque no endereço acima para copiá-lo`,
      ]
    : [
        `💠 Pague via Pix Copia e Cola:`,
        ``,
        `<code>${payment.pixCode}</code>`,
        ``,
        `👆 Toque no código acima para copiá-lo`,
      ];
  const closingLine = isCrypto
    ? `⏳ A confirmação na blockchain pode levar alguns minutos. Após confirmado, seu acesso será liberado automaticamente.`
    : `‼️ Após o pagamento seu acesso será liberado automaticamente.`;
  try {
    paymentMsg = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text: [
      `🌟 Você selecionou o seguinte plano:`,
      ``,
      `🎁 Plano: ${displayName}`,
      `💰 Valor: ${priceFormatted}`,
      ``,
      `💳 Total: ${priceFormatted}`,
      ``,
      ...paymentInstructionLines,
      ``,
      closingLine,
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [{ text: isCrypto ? "📋 Copiar endereço" : "📋 Copiar código Pix", copy_text: { text: payment.pixCode } }],
        [{ text: "📱 Ver QR Code", callback_data: `qrcode:${ctx.node.id}` }],
      ],
    },
    });
  } catch (err) {
    // Envio do PIX falhou (bot bloqueado, chat sumiu, Telegram fora do ar).
    // A cobrança JÁ existe no gateway — não propaga o erro pra cima: isso
    // pularia o bloco de tracking logo abaixo (Utmify waiting_payment +
    // marco "PIX gerado" no funil), deixando o funil mostrar uma compra sem
    // checkout correspondente quando o lead pagar por fora (ex: reabriu o
    // chat e copiou o código antes, ou reconciliação manual). paymentMsg
    // permanece null; runPaymentCallback não depende dele pra nada crítico.
    console.error(
      `[payment] ✗ Falha ao enviar mensagem do Pix p/ chat ${ctx.chatId} (lead ${ctx.lead.id}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    // Roda inclusive no caminho de exceção do envio acima. O insert já
    // viajou em paralelo, então normalmente resolve na hora.
    const { data, error } = await txInsertPromise;
    txRecord = data;
    if (error) {
      // Antes esse erro era descartado em silêncio. Se o insert falhar
      // (RLS, constraint, PostgREST 5xx) a cobrança fica órfã — precisa
      // aparecer no log pra dar pra reconciliar.
      console.error(
        `[payment] ✗ FALHA ao gravar transaction external_id=${payment.transactionId} lead=${ctx.lead.id}: ${error.message}`,
      );
    }
  }

  // Fire checkout (Facebook InitiateCheckout) + Utmify waiting_payment.
  // Config do bot vem do botCache — é a MESMA linha que o webhook já
  // carregou pra atender esse clique; refetch era round-trip puro.
  const botConfig = (botCache.get(ctx.lead.bot_id) as BotTrackingConfig | undefined)
    ?? (await db
      .from("bots")
      .select("facebook_pixel_id, facebook_access_token, facebook_pixel_id_backup, facebook_access_token_backup, facebook_backup_enabled, tiktok_pixel_id, tiktok_access_token, utmify_api_key")
      .eq("id", ctx.lead.bot_id)
      .single()).data as BotTrackingConfig | null;

  if (botConfig) {
    const fbCapi = new FacebookCapi(botConfig.facebook_pixel_id ?? "", botConfig.facebook_access_token ?? "", {
      pixelId: botConfig.facebook_pixel_id_backup,
      accessToken: botConfig.facebook_access_token_backup,
      enabled: botConfig.facebook_backup_enabled,
    });
    const tiktokEvents = new TiktokEvents(botConfig.tiktok_pixel_id ?? "", botConfig.tiktok_access_token ?? "", ctx.lead.bot_id);
    const utmSvc = new UtmifyService(botConfig.utmify_api_key ?? "");
    const trackingSvc = new TrackingService(db, fbCapi, utmSvc, tiktokEvents);

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

    // Facebook InitiateCheckout — usa gatewayName (= productLabelForExternal):
    // ghost OU genérico "Product N". NUNCA o nome real (mesma regra da gateway).
    trackingSvc.trackCheckout({
      tenantId: ctx.lead.tenant_id,
      leadId: ctx.lead.id,
      botId: ctx.lead.bot_id,
      amount: typedProduct.price,
      currency: typedProduct.currency,
      lead: leadInfo,
      productId: typedProduct.id,
      productName: gatewayName,
      // (#B6) sem isso, um 2º Pix do mesmo lead+produto (timeout padrão de
      // 15min é comum) reusa o mesmo event_id do 1º e é deduplicado como
      // duplicata pela TikTok/Meta.
      transactionId: txRecord?.id,
    }).catch((e) => console.error("[tracking] Failed to track checkout:", e));

    // Utmify waiting_payment — também ghost
    if (botConfig.utmify_api_key) {
      utmSvc.sendOrder({
        orderId: txRecord?.id ?? payment.transactionId,
        status: "waiting_payment",
        platform: "eaglebot",
        paymentMethod: isCrypto ? "crypto" : "pix",
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
        paymentButtonId,
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
      // sempre explícito (nunca omitido) — limpa um id de botão de um
      // pagamento anterior pra não vazar num pagamento de outra origem
      // (nó de pagamento dedicado ou outro botão) pro mesmo lead.
      pending_payment_button_id: paymentButtonId ?? null,
      pending_identifier: identifier,
      pending_pix_code: payment.pixCode,
      pending_pix_image: qrCodeUrl,
      awaiting_product_selection: false,
    },
  };
}
