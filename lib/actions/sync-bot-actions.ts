"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/actions/admin-actions";
import { nanoid } from "nanoid";

function storage() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function ensureBucket() {
  const admin = storage();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.id === "media")) {
    await admin.storage.createBucket("media", { public: true });
  }
}

/**
 * Sincroniza nome + foto de perfil do bot DIRETO do Telegram (getMe) pro banco:
 * - first_name → redirect_display_name (o nome amigável que aparece na /t)
 * - foto de perfil → baixa do Telegram, sobe no Storage, salva como avatar_url
 *
 * Roda na criação do bot e via botão "Sincronizar" na config (pros bots antigos).
 * Só sobrescreve campos que estão VAZIOS por padrão? Não — sync sempre atualiza,
 * pra refletir mudanças feitas no Telegram. (O usuário pode editar manualmente depois.)
 */
export async function syncBotFromTelegram(botId: string): Promise<{ ok: boolean; name?: string; hasPhoto?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Não autenticado" };

  // dono do bot (ou admin)
  const admin = await isAdmin();
  let q = supabase.from("bots").select("id,telegram_token,tenant_id").eq("id", botId);
  if (!admin) q = q.eq("tenant_id", user.id);
  const { data: bot } = await q.single();
  if (!bot?.telegram_token) return { ok: false, error: "Bot não encontrado" };

  const token = bot.telegram_token as string;
  const tg = `https://api.telegram.org/bot${token}`;

  // 1) getMe → nome do bot
  let name: string | undefined;
  let botUserId: number | undefined;
  try {
    const me = await (await fetch(`${tg}/getMe`)).json();
    if (me?.ok && me.result?.first_name) name = String(me.result.first_name).trim();
    botUserId = me?.result?.id as number | undefined;
  } catch {
    return { ok: false, error: "Falha ao consultar o Telegram" };
  }

  // 2) foto de perfil → file_id → file_path → download → Storage
  let avatarUrl: string | undefined;
  try {
    if (botUserId) {
      const photos = await (await fetch(`${tg}/getUserProfilePhotos?user_id=${botUserId}&limit=1`)).json();
      const sizes = photos?.result?.photos?.[0];
      const fileId = sizes?.[sizes.length - 1]?.file_id; // maior resolução
      if (fileId) {
        const file = await (await fetch(`${tg}/getFile?file_id=${fileId}`)).json();
        const filePath = file?.result?.file_path;
        if (filePath) {
          const img = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
          if (img.ok) {
            const buf = Buffer.from(await img.arrayBuffer());
            await ensureBucket();
            const key = `${bot.tenant_id}/bot-avatars/${botId}-${nanoid(6)}.jpg`;
            const { error: upErr } = await storage().storage.from("media").upload(key, buf, {
              contentType: "image/jpeg",
              upsert: true,
            });
            if (!upErr) {
              avatarUrl = storage().storage.from("media").getPublicUrl(key).data.publicUrl;
            }
          }
        }
      }
    }
  } catch {
    // foto é best-effort — se falhar, mantém o nome
  }

  // 3) grava o que conseguiu
  const patch: Record<string, string> = {};
  if (name) patch.redirect_display_name = name;
  if (avatarUrl) patch.avatar_url = avatarUrl;
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Telegram não retornou nome nem foto" };
  }
  const { error } = await supabase.from("bots").update(patch).eq("id", botId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, name, hasPhoto: !!avatarUrl };
}
