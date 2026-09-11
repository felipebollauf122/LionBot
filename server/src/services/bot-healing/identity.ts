import { supabase } from "../../db.js";
import { TelegramApi } from "../../telegram/api.js";
import type { HealingBot } from "./recovery.js";
import { tokenHash } from "./recovery.js";
import { RecoveryAttention, type Identity } from "./types.js";

export interface TelegramSelf { id: number; first_name: string; username: string; is_bot: boolean }
const BUCKET = "bot-identity";
const MAX_PHOTO = 5 * 1024 * 1024;

export async function backupIdentity(bot: HealingBot, me: TelegramSelf): Promise<void> {
  const api = new TelegramApi(bot.telegram_token);
  const description = await api.call<{ description: string }>("getMyDescription");
  const about = await api.call<{ short_description: string }>("getMyShortDescription");
  const photos = await api.call<{ photos: Array<Array<{ file_id: string }>> }>("getUserProfilePhotos", { user_id: me.id, limit: 1 });
  const latest = photos.photos[0]?.at(-1);
  let photoPath: string | null = null;
  if (latest) {
    const file = await api.call<{ file_path: string; file_size?: number }>("getFile", { file_id: latest.file_id });
    if (file.file_size && file.file_size > MAX_PHOTO) throw new RecoveryAttention("profile_photo_too_large");
    const response = await fetch(`https://api.telegram.org/file/bot${bot.telegram_token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error("identity_photo_download_failed");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("identity_photo_empty");
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_PHOTO) throw new RecoveryAttention("profile_photo_too_large");
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) throw new Error("identity_photo_empty");
    // Version by content: a failed metadata write cannot overwrite the previous backup.
    photoPath = `${bot.tenant_id}/${bot.id}/${tokenHash(bytes.toString("base64"))}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(photoPath, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error("identity_photo_storage_failed");
  }
  const identity: Identity = { name: me.first_name, username: me.username, telegramId: me.id, description: description.description, about: about.short_description, photoPath };
  const { error } = await supabase.from("bot_recovery_settings").update({ identity, identity_token_hash: tokenHash(bot.telegram_token), backed_up_at: new Date().toISOString() }).eq("bot_id", bot.id);
  if (error) throw new Error("identity_backup_write_failed");
}

export async function readIdentityPhoto(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("identity_photo_backup_missing");
  if (data.size > MAX_PHOTO) throw new RecoveryAttention("profile_photo_too_large");
  return Buffer.from(await data.arrayBuffer());
}
