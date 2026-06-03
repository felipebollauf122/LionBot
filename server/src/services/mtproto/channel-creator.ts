import { supabase } from "../../db.js";
import { config } from "../../config.js";
import { MtprotoClient } from "./client.js";

interface ChannelTemplate {
  id: string;
  new_channel_title: string;
  new_channel_about: string;
  welcome_text: string;
  profile_photo_url: string | null;
  enable_reactions: boolean;
  protect_content: boolean;
  auto_recreate_on_ban: boolean;
  media_items: Array<{
    url: string;
    kind: "photo" | "video";
    caption?: string;
    mime_type?: string;
    file_name?: string;
  }>;
}

interface CreateResult {
  ok: true;
  instanceId: string;
  channelId: string;
  inviteLink: string | null;
  title: string;
}

interface CreateError {
  ok: false;
  error: string;
}

async function downloadMedia(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[channel-creator] download ${url} → ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
    return { buffer: buf, mimeType };
  } catch (err) {
    console.error(`[channel-creator] download ${url} falhou:`, err);
    return null;
  }
}

/**
 * Cria um canal completo (canal + foto + fluxo de mídias + texto +
 * permissões + invite link) a partir de um template e uma conta MTProto.
 * Registra o resultado em channel_instances.
 *
 * Usado pelo:
 *  - Botão "Criar agora" no painel (acionado pelo owner)
 *  - Auto-recriação do poller (quando canal/conta cai e template tem
 *    auto_recreate_on_ban=true)
 */
export async function createChannelInstance(
  tenantId: string,
  templateId: string,
  accountId: string,
): Promise<CreateResult | CreateError> {
  // Carrega template
  const { data: tpl } = await supabase
    .from("channel_templates")
    .select("*")
    .eq("id", templateId)
    .eq("tenant_id", tenantId)
    .single();
  if (!tpl) return { ok: false, error: "template não encontrado" };
  const template = tpl as ChannelTemplate;

  // Carrega conta
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, session_string, status")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();
  if (!account?.session_string || account.status !== "active") {
    return { ok: false, error: `conta ${accountId} não está active ou sem sessão` };
  }

  const client = new MtprotoClient(
    config.telegramApiId,
    config.telegramApiHash,
    account.session_string,
  );

  try {
    await client.connect();

    // 1) Cria canal
    let created: { channelId: string; accessHash: string };
    try {
      created = await client.createChannel(template.new_channel_title, template.new_channel_about ?? "");
      console.log(`[channel-creator] canal criado ${created.channelId} pela conta ${accountId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[channel-creator] createChannel falhou:`, msg);
      return { ok: false, error: `createChannel: ${msg}` };
    }

    // 2) Foto de perfil (best-effort, não fatal)
    if (template.profile_photo_url) {
      const photo = await downloadMedia(template.profile_photo_url);
      if (photo) {
        try {
          await client.setChannelPhoto(created.channelId, created.accessHash, photo.buffer);
          await new Promise((r) => setTimeout(r, 800));
        } catch (err) {
          console.warn(`[channel-creator] setChannelPhoto falhou (não fatal):`, err);
        }
      }
    }

    // 3) Aplica permissões (best-effort)
    try {
      await client.setChannelReactions(created.channelId, created.accessHash, template.enable_reactions);
    } catch (err) {
      console.warn(`[channel-creator] setChannelReactions falhou:`, err);
    }
    if (template.protect_content) {
      try {
        await client.setChannelProtectContent(created.channelId, created.accessHash, true);
      } catch (err) {
        console.warn(`[channel-creator] setChannelProtectContent falhou:`, err);
      }
    }

    // 4) Posta welcome text (se houver)
    if (template.welcome_text?.trim()) {
      try {
        await client.sendTextToChannel(created.channelId, created.accessHash, template.welcome_text);
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err) {
        console.warn(`[channel-creator] sendTextToChannel falhou:`, err);
      }
    }

    // 5) Posta mídias em sequência (delay 1.5s)
    for (let i = 0; i < (template.media_items ?? []).length; i++) {
      const item = template.media_items[i];
      const dl = await downloadMedia(item.url);
      if (!dl) continue;
      try {
        await client.sendMediaToChannel(
          created.channelId,
          created.accessHash,
          {
            buffer: dl.buffer,
            mimeType: item.mime_type ?? dl.mimeType,
            fileName: item.file_name ?? `media_${i + 1}.${item.kind === "video" ? "mp4" : "jpg"}`,
          },
          item.caption,
          item.kind,
        );
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.error(`[channel-creator] sendMediaToChannel item ${i} falhou:`, err);
      }
    }

    // 6) Invite link
    let inviteLink: string | null = null;
    try {
      inviteLink = await client.exportChannelInvite(created.channelId, created.accessHash);
    } catch (err) {
      console.warn(`[channel-creator] exportChannelInvite falhou:`, err);
    }

    // 7) Registra channel_instance
    const { data: inserted, error: insErr } = await supabase
      .from("channel_instances")
      .insert({
        tenant_id: tenantId,
        template_id: templateId,
        account_id: accountId,
        channel_id: created.channelId,
        access_hash: created.accessHash,
        invite_link: inviteLink,
        title: template.new_channel_title,
        status: "active",
      })
      .select("id")
      .single();
    if (insErr) {
      console.error(`[channel-creator] insert channel_instances falhou:`, insErr);
      return { ok: false, error: `db: ${insErr.message}` };
    }

    return {
      ok: true,
      instanceId: inserted.id,
      channelId: created.channelId,
      inviteLink,
      title: template.new_channel_title,
    };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Escolhe próxima conta substituta — usado pela auto-recriação.
 * Critério: status='active', mais recente, diferente da que está sendo
 * substituída.
 */
export async function pickReplacementAccount(
  tenantId: string,
  exceptAccountId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("mtproto_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .neq("id", exceptAccountId)
    .not("session_string", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data ?? [])[0]?.id ?? null;
}
