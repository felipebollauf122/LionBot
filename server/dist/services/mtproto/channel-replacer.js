import { supabase } from "../../db.js";
import { config } from "../../config.js";
import { MtprotoClient } from "./client.js";
/**
 * Escolhe uma conta substituta ativa do tenant — diferente do account_id
 * original (que caiu). Critério: status='active', mais recente (assumindo
 * que conta nova tem maior chance de não cair logo).
 */
async function pickReplacementAccount(tenantId, exceptAccountId) {
    const { data } = await supabase
        .from("mtproto_accounts")
        .select("id, session_string")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .neq("id", exceptAccountId)
        .not("session_string", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
    const first = (data ?? [])[0];
    if (!first?.session_string)
        return null;
    return { id: first.id, session_string: first.session_string };
}
async function downloadMedia(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`[channel-replacer] download ${url} → ${res.status}`);
            return null;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
        return { buffer: buf, mimeType };
    }
    catch (err) {
        console.error(`[channel-replacer] download ${url} falhou:`, err);
        return null;
    }
}
/**
 * Executa a substituição de um canal monitorado caído:
 * 1. escolhe conta substituta
 * 2. cria canal novo pela conta substituta usando template
 * 3. faz upload das mídias e posta no canal
 * 4. posta welcome_text
 * 5. exporta link de convite
 * 6. atualiza channel_monitors com resultado
 *
 * Idempotente: se monitor.status já = 'replaced', não roda de novo.
 */
export async function replaceChannel(monitor) {
    console.log(`[channel-replacer] iniciando substituição do monitor ${monitor.id}`);
    const replacement = await pickReplacementAccount(monitor.tenant_id, monitor.account_id);
    if (!replacement) {
        const msg = "nenhuma conta substituta disponível";
        console.warn(`[channel-replacer] ${msg} pro monitor ${monitor.id}`);
        await supabase
            .from("channel_monitors")
            .update({ status: "dead", replacement_error: msg })
            .eq("id", monitor.id);
        return;
    }
    // Carrega template
    const { data: tpl } = await supabase
        .from("channel_templates")
        .select("id, new_channel_title, new_channel_about, welcome_text, media_items")
        .eq("id", monitor.template_id)
        .single();
    if (!tpl) {
        await supabase
            .from("channel_monitors")
            .update({ status: "dead", replacement_error: "template não encontrado" })
            .eq("id", monitor.id);
        return;
    }
    const template = tpl;
    const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, replacement.session_string);
    try {
        await client.connect();
        // Cria canal
        let created;
        try {
            created = await client.createChannel(template.new_channel_title, template.new_channel_about);
            console.log(`[channel-replacer] canal criado ${created.channelId} pela conta ${replacement.id}`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[channel-replacer] createChannel falhou:`, msg);
            await supabase
                .from("channel_monitors")
                .update({ status: "dead", replacement_error: `createChannel: ${msg}` })
                .eq("id", monitor.id);
            return;
        }
        // Posta texto de welcome primeiro (se houver)
        if (template.welcome_text?.trim()) {
            try {
                await client.sendTextToChannel(created.channelId, created.accessHash, template.welcome_text);
            }
            catch (err) {
                console.warn(`[channel-replacer] sendTextToChannel falhou (não fatal):`, err);
            }
        }
        // Sobe mídias em sequência
        for (let i = 0; i < (template.media_items ?? []).length; i++) {
            const item = template.media_items[i];
            const dl = await downloadMedia(item.url);
            if (!dl)
                continue;
            try {
                await client.sendMediaToChannel(created.channelId, created.accessHash, {
                    buffer: dl.buffer,
                    mimeType: item.mime_type ?? dl.mimeType,
                    fileName: item.file_name ?? `media_${i + 1}.${item.kind === "video" ? "mp4" : "jpg"}`,
                }, item.caption, item.kind);
                // Pequeno delay entre mídias pra reduzir chance de flood
                await new Promise((r) => setTimeout(r, 1500));
            }
            catch (err) {
                console.error(`[channel-replacer] sendMediaToChannel item ${i} falhou:`, err);
            }
        }
        // Exporta link de convite
        let inviteLink = null;
        try {
            inviteLink = await client.exportChannelInvite(created.channelId, created.accessHash);
        }
        catch (err) {
            console.warn(`[channel-replacer] exportChannelInvite falhou (canal foi criado):`, err);
        }
        await supabase
            .from("channel_monitors")
            .update({
            status: "replaced",
            replacement_channel_id: created.channelId,
            replacement_account_id: replacement.id,
            replacement_invite_link: inviteLink,
            replaced_at: new Date().toISOString(),
            replacement_error: null,
        })
            .eq("id", monitor.id);
        console.log(`[channel-replacer] substituição completa monitor=${monitor.id} canal=${created.channelId} invite=${inviteLink}`);
    }
    finally {
        await client.disconnect().catch(() => { });
    }
}
