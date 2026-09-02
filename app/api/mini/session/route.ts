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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  // JSON.parse("null") devolve null sem lançar, e null passa direto pelo catch
  // acima. Sem esta guarda, o acesso a campo abaixo estoura TypeError e a rota
  // devolve 500 — quebrando a promessa de que recusa prevista volta como dado.
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, reason: "malformed" }, { status: 400 });
  }

  const { botId: rawBotId, initData: rawInitData } = body as {
    botId?: unknown;
    initData?: unknown;
  };
  const botId = typeof rawBotId === "string" ? rawBotId : "";
  const initData = typeof rawInitData === "string" ? rawInitData : "";
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

  // Bot inexistente NÃO curto-circuita: verificamos contra um token inerte para
  // que o `reason` e o tempo de resposta fiquem indistinguíveis do caso em que o
  // bot existe e a assinatura está errada. Curto-circuitar aqui entregava um
  // oráculo de existência de botId — por conteúdo (bad_hash vs missing_hash) e
  // por tempo (sem HMAC vs dois HMAC).
  const token = bot?.telegram_token ?? "token-inexistente-para-verificacao-uniforme";

  const result = verifyInitData(initData, token);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  // Assinatura válida mas bot não existe no banco: não há sessão a devolver.
  if (!bot?.telegram_token) {
    return NextResponse.json({ ok: false, reason: "bad_hash" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, telegramUserId: result.telegramUserId });
}
