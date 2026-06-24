import { MtprotoClient } from "../services/mtproto/client.js";
import { createChannelInstance, pickReplacementAccount } from "../services/mtproto/channel-creator.js";
import { config } from "../config.js";
/**
 * Poller dos channel_instances ativos. A cada chamada:
 * 1. Pega instances ativas onde o template tem auto_recreate_on_ban=true.
 * 2. Pra cada, faz health check do canal pela conta dona (channels.GetChannels).
 * 3. Se conta morta (auth_failed) OU canal inválido/forbidden, marca
 *    status='dead' e dispara recriação em conta substituta.
 *
 * Instâncias com template auto_recreate=false são ignoradas — owner não
 * pediu recriação automática.
 */
export async function pollChannelMonitors(db) {
    if (!config.telegramApiId || !config.telegramApiHash)
        return;
    const { data: instances } = await db
        .from("channel_instances")
        .select(`
      id, tenant_id, template_id, account_id, channel_id, access_hash, status,
      account:mtproto_accounts!inner(id, session_string, status),
      template:channel_templates!inner(id, auto_recreate_on_ban)
    `)
        .eq("status", "active")
        .limit(200);
    if (!instances || instances.length === 0)
        return;
    for (const inst of instances) {
        // Pula instâncias cujo template não pede auto-recriação
        if (!inst.template?.auto_recreate_on_ban)
            continue;
        const checkedAt = new Date().toISOString();
        const account = inst.account;
        // Conta sem session OU já banida → trata como dead direto
        if (!account?.session_string || account.status === "banned") {
            console.log(`[channel-monitor] instance ${inst.id}: conta dona ${inst.account_id} sem sessão/banida → recreate`);
            await db
                .from("channel_instances")
                .update({
                last_checked_at: checkedAt,
                last_check_error: `account ${account?.status ?? "no_session"}`,
                detected_dead_at: checkedAt,
                status: "dead",
            })
                .eq("id", inst.id);
            await tryRecreate(db, inst);
            continue;
        }
        // Health check do canal
        const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, account.session_string);
        let result;
        try {
            result = await client.getChannelStatus(inst.channel_id, inst.access_hash);
        }
        catch (err) {
            console.error(`[channel-monitor] erro inesperado na instance ${inst.id}:`, err);
            await client.disconnect().catch(() => { });
            await db
                .from("channel_instances")
                .update({
                last_checked_at: checkedAt,
                last_check_error: err instanceof Error ? err.message : String(err),
            })
                .eq("id", inst.id);
            continue;
        }
        finally {
            await client.disconnect().catch(() => { });
        }
        if (result.ok) {
            await db
                .from("channel_instances")
                .update({
                last_checked_at: checkedAt,
                last_check_error: null,
                title: result.title,
            })
                .eq("id", inst.id);
            continue;
        }
        // auth_failed → conta dona caiu (efeito colateral: marca a conta como banned)
        if (result.reason === "auth_failed") {
            console.warn(`[channel-monitor] conta ${account.id} auth falhou: ${result.detail}`);
            await db
                .from("mtproto_accounts")
                .update({
                status: "banned",
                last_error: result.detail,
                session_string: null,
            })
                .eq("id", account.id);
        }
        if (result.reason === "channel_invalid" || result.reason === "channel_private" || result.reason === "auth_failed") {
            console.log(`[channel-monitor] instance ${inst.id} DETECTOU CANAL CAÍDO: ${result.reason}`);
            await db
                .from("channel_instances")
                .update({
                last_checked_at: checkedAt,
                last_check_error: result.detail,
                detected_dead_at: checkedAt,
                status: "dead",
            })
                .eq("id", inst.id);
            await tryRecreate(db, inst);
            continue;
        }
        // 'other' = erro transiente
        await db
            .from("channel_instances")
            .update({
            last_checked_at: checkedAt,
            last_check_error: result.detail,
        })
            .eq("id", inst.id);
    }
}
async function tryRecreate(db, inst) {
    const replacementAccountId = await pickReplacementAccount(inst.tenant_id, inst.account_id);
    if (!replacementAccountId) {
        await db
            .from("channel_instances")
            .update({ recreation_error: "nenhuma conta substituta disponível" })
            .eq("id", inst.id);
        return;
    }
    console.log(`[channel-monitor] recriando instance ${inst.id} via conta ${replacementAccountId}`);
    const result = await createChannelInstance(inst.tenant_id, inst.template_id, replacementAccountId);
    if (!result.ok) {
        await db
            .from("channel_instances")
            .update({ recreation_error: result.error })
            .eq("id", inst.id);
        return;
    }
    await db
        .from("channel_instances")
        .update({
        status: "replaced",
        recreated_as_instance_id: result.instanceId,
        recreated_at: new Date().toISOString(),
        recreation_error: null,
    })
        .eq("id", inst.id);
    console.log(`[channel-monitor] instance ${inst.id} recriada como ${result.instanceId} (invite: ${result.inviteLink})`);
}
