import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Redirecionador mascarado: o botão da página /t aponta pra ESTE endpoint (sob o
 * nosso domínio profissional), não pro t.me direto. O Facebook vê o nosso domínio
 * — destino transparente — em vez de t.me (que ele trata como não-transparente e
 * marca como link enganoso). Aqui só validamos o bot e fazemos 302 pro Telegram.
 *
 * GET /go?bot=<botId>&tid=<tid>
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const botId = url.searchParams.get("bot") ?? "";
  const tid = url.searchParams.get("tid") ?? "";

  if (!botId) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bot } = await supabase
    .from("bots")
    .select("bot_username,is_active")
    .eq("id", botId)
    .eq("is_active", true)
    .single();

  if (!bot?.bot_username) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // deep link do Telegram com o tid (carrega o tracking do clique até o /start).
  const startParam = tid ? `?start=${encodeURIComponent(tid)}` : "";
  const telegram = `https://t.me/${bot.bot_username}${startParam}`;

  // 302 (temporário) — o destino pode mudar; não queremos cache permanente.
  return NextResponse.redirect(telegram, { status: 302 });
}
