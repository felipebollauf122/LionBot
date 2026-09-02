import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { verifyInitData } from "@/lib/social-proof/init-data";

export const dynamic = "force-dynamic";

/**
 * Confirma que quem abriu o Mini App veio mesmo de dentro do Telegram.
 *
 * O feed já foi renderizado sem esperar por isto — validar antes de pintar
 * traria de volta a tela branca que a decisão de SSR existe pra evitar. Esta
 * rota roda em paralelo e serve pra saber QUEM abriu.
 *
 * POST { botId, initData } → { ok, telegramUserId } | { ok: false, reason }
 */
export async function POST(req: NextRequest) {
  let body: { botId?: unknown; initData?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  const botId = typeof body.botId === "string" ? body.botId : "";
  const initData = typeof body.initData === "string" ? body.initData : "";
  if (!botId || !initData) {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bot } = await supabase
    .from("bots")
    .select("telegram_token")
    .eq("id", botId)
    .single();

  if (!bot?.telegram_token) {
    return NextResponse.json({ ok: false, reason: "bad_hash" }, { status: 401 });
  }

  const result = verifyInitData(initData, bot.telegram_token);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  return NextResponse.json({ ok: true, telegramUserId: result.telegramUserId });
}
