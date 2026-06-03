import type { SupabaseClient } from "@supabase/supabase-js";
import { TelegramApi } from "../telegram/api.js";
import { FlowProcessor } from "../engine/flow-processor.js";
import { LeadService } from "./lead-service.js";
import { buildGateway } from "./gateway-factory.js";
import { FacebookCapi } from "./facebook-capi.js";
import { UtmifyService } from "./utmify.js";
import { TrackingService } from "./tracking-service.js";
import { productLabelForExternal } from "./external-product-label.js";
import { addDelayedJob } from "../queue.js";
import { config } from "../config.js";
import { flowByIdCache } from "../cache.js";
import type { Flow } from "../engine/flow-processor.js";
import type { Lead } from "../engine/types.js";

interface Bot {
  id: string;
  tenant_id: string;
  telegram_token: string;
  protect_content: boolean;
  payment_gateway: string | null;
  facebook_pixel_id: string | null;
  facebook_access_token: string | null;
  utmify_api_key: string | null;
  sigilopay_public_key: string | null;
  sigilopay_secret_key: string | null;
  evpay_api_key: string | null;
  evpay_project_id: string | null;
}

interface Transaction {
  id: string;
  tenant_id: string;
  lead_id: string;
  bot_id: string;
  flow_id: string;
  product_id: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  sent_to_facebook?: boolean | null;
}

/**
 * Dispara Purchase no Facebook + retoma o flow na edge "paid".
 * Chamado de 3 lugares:
 *  1. payment-webhook quando user já tinha email no state (não vai pedir)
 *  2. telegram-webhook quando user mandou email válido respondendo o pedido
 *  3. worker de timeout, 2h após pagamento, se user nunca respondeu
 */
const FALLBACK_DELIVERY_TEXT =
  "✅ <b>Pagamento confirmado e acesso liberado!</b>\n\n" +
  "Em instantes você recebe os detalhes do produto. " +
  "Se algo der errado, é só responder aqui que a gente resolve.";

async function sendWithRetry(
  telegram: TelegramApi,
  chatId: number,
  text: string,
  ctx: string,
): Promise<boolean> {
  // 3 tentativas com backoff (1s, 3s). Trata rate-limit 429 e falhas de rede
  // transientes. Se nas 3 falhar, devolve false — caller faz log.
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await telegram.sendMessage({ chatId, text });
      if (r) return true;
      lastErr = new Error("sendMessage returned null");
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // User bloqueou o bot: não adianta tentar de novo
      if (/bot was blocked by the user|Forbidden|chat not found|user is deactivated/i.test(msg)) {
        console.warn(`[purchase-completer/${ctx}] cliente inacessível: ${msg} — sem retry`);
        return false;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  console.error(`[purchase-completer/${ctx}] sendMessage falhou após 3 tentativas:`, lastErr);
  return false;
}

/**
 * Envia a confirmação genérica de pagamento. Usado como fallback sempre
 * que o flow não consegue ser retomado por qualquer motivo. Garante que
 * o cliente nunca fica sem mensagem após pagar.
 */
async function sendDeliveryFallback(bot: Bot, lead: Lead, reason: string): Promise<void> {
  console.warn(`[purchase-completer] FALLBACK enviado — motivo: ${reason}`);
  const telegram = new TelegramApi(bot.telegram_token, { protectContent: bot.protect_content });
  await sendWithRetry(telegram, lead.telegram_user_id, FALLBACK_DELIVERY_TEXT, `fallback:${reason}`);
}

export async function completePurchase(
  db: SupabaseClient,
  bot: Bot,
  lead: Lead,
  transaction: Transaction,
): Promise<void> {
  // Idempotência intra-processo: se já entregou esse tx pra esse lead,
  // não faz de novo. Persiste no lead.state.
  const deliveredKey = `delivered_tx_${transaction.id}`;
  if (lead.state[deliveredKey] === true) {
    console.log(
      `[purchase-completer] tx ${transaction.id} já foi entregue pra lead ${lead.id} — skip`,
    );
    return;
  }

  const leadService = new LeadService(db);

  // Limpa pending_email_tx_id e marca delivered antes de tudo. Se algo
  // falhar daqui pra frente, marcamos pra evitar reentrada — mas
  // garantimos abaixo que o cliente sempre recebe ALGO.
  const startState = { ...lead.state, [deliveredKey]: true };
  if (startState.pending_email_tx_id) delete startState.pending_email_tx_id;
  await leadService.updateState(lead.id, startState);
  lead.state = startState;

  // Tracking (fire-and-forget, nunca bloqueia entrega)
  try {
    // Dedup (#6): se essa transação já foi enviada ao Facebook, não dispara
    // de novo (evita Purchase duplicado que derruba EMQ). Lê o flag fresco
    // do DB pra cobrir reentradas (webhook duplicado, retry de worker).
    const { data: txFlag } = await db
      .from("transactions")
      .select("sent_to_facebook, paid_at")
      .eq("id", transaction.id)
      .maybeSingle();
    const alreadySent = (txFlag as { sent_to_facebook?: boolean } | null)?.sent_to_facebook === true;
    const paidAtIso = (txFlag as { paid_at?: string | null } | null)?.paid_at ?? transaction.paid_at ?? undefined;

    if (alreadySent) {
      console.log(`[purchase-completer] tx ${transaction.id} já enviada ao Facebook — pulando CAPI (entrega segue normal)`);
    } else {
      const facebookCapi = new FacebookCapi(bot.facebook_pixel_id ?? "", bot.facebook_access_token ?? "");
      const utmify = new UtmifyService(bot.utmify_api_key ?? "");
      const trackingService = new TrackingService(db, facebookCapi, utmify);
      const { data: product } = await db
        .from("products")
        .select("id, name, ghost_name")
        .eq("id", transaction.product_id)
        .single();
      trackingService
        .trackPurchase({
          tenantId: transaction.tenant_id,
          leadId: transaction.lead_id,
          botId: transaction.bot_id,
          transactionId: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          paidAtIso,
          lead: {
            id: lead.id,
            tid: lead.tid,
            fbclid: lead.fbclid,
            firstName: lead.first_name,
            lastName: lead.last_name ?? undefined,
            email: String(lead.state.email ?? ""),
            phone: String(lead.state.phone ?? ""),
            document: String(lead.state.document ?? ""),
            utmSource: lead.utm_source ?? undefined,
            utmMedium: lead.utm_medium ?? undefined,
            utmCampaign: lead.utm_campaign ?? undefined,
            utmContent: lead.utm_content ?? undefined,
            utmTerm: lead.utm_term ?? undefined,
            telegramUserId: lead.telegram_user_id,
            botId: lead.bot_id,
          },
          customerDocument: String(lead.state.document ?? ""),
          productId: product?.id ?? transaction.product_id,
          // NUNCA expor nome real pra fora — ghost se houver, senão "Product N"
          productName: productLabelForExternal({
            id: product?.id ?? transaction.product_id,
            ghost_name: (product as { ghost_name?: string | null } | null)?.ghost_name ?? null,
          }),
        })
        .then(async (res) => {
          // Marca flag só se o Facebook confirmou recebimento (#6)
          if (res?.fbSent) {
            await db
              .from("transactions")
              .update({ sent_to_facebook: true })
              .eq("id", transaction.id);
          }
        })
        .catch((e) => console.error("[purchase-completer] Tracking error:", e));
    }
  } catch (err) {
    console.error("[purchase-completer] tracking setup falhou (segue entrega):", err);
  }

  // Entrega: tenta retomar o flow no edge "paid". Em QUALQUER falha
  // (flow não existe, edge faltando, executeFlow estoura), cai no
  // fallback genérico pra garantir que o cliente recebe a confirmação.
  const paymentNodeId = String(lead.state.pending_payment_node_id ?? "");

  if (!paymentNodeId || !transaction.flow_id) {
    await sendDeliveryFallback(bot, lead, "sem pending_payment_node_id ou flow_id (provável remarketing)");
    return;
  }

  let flow: Flow | null = flowByIdCache.get(transaction.flow_id) as unknown as Flow | null;
  if (!flow) {
    try {
      const { data } = await db.from("flows").select("*").eq("id", transaction.flow_id).single();
      if (!data) {
        await sendDeliveryFallback(bot, lead, `flow ${transaction.flow_id} não encontrado`);
        return;
      }
      flow = data as Flow;
      flowByIdCache.set(transaction.flow_id, data);
    } catch (err) {
      console.error("[purchase-completer] erro ao buscar flow:", err);
      await sendDeliveryFallback(bot, lead, "erro ao buscar flow no DB");
      return;
    }
  }

  const paidEdge = flow.flow_data.edges.find(
    (e) => e.source === paymentNodeId && e.sourceHandle === "paid",
  );
  if (!paidEdge) {
    await sendDeliveryFallback(bot, lead, `edge "paid" não conectada no nó ${paymentNodeId}`);
    return;
  }

  console.log(`[purchase-completer] Resuming flow on "paid" edge → node ${paidEdge.target}`);
  try {
    const telegram = new TelegramApi(bot.telegram_token, { protectContent: bot.protect_content });
    const { gateway, kind: gatewayKind } = buildGateway(bot);
    const processor = new FlowProcessor(db, leadService, { addDelayedJob }, {
      gateway,
      gatewayKind,
      baseWebhookUrl: config.baseWebhookUrl,
    });
    await processor.executeFlow(
      flow,
      lead,
      telegram,
      lead.telegram_user_id,
      paidEdge.target,
    );
  } catch (err) {
    console.error(`[purchase-completer] executeFlow estourou:`, err);
    // Flow falhou no meio — manda fallback pra cliente não ficar sem nada
    await sendDeliveryFallback(bot, lead, "executeFlow falhou no meio");
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}
