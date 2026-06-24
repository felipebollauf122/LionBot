import { supabase } from "../../db.js";
import { config } from "../../config.js";
import { MtprotoClient } from "./client.js";
const sessions = new Map(); // key = accountId
const TTL_MS = 5 * 60 * 1000; // 5 min sem heartbeat → fecha
async function persistMessage(accountId, msg) {
    await supabase
        .from("mtproto_incoming_messages")
        .upsert({
        account_id: accountId,
        tg_message_id: msg.tgMessageId,
        from_peer_id: msg.fromPeerId,
        from_peer_name: msg.fromPeerName,
        text: msg.text,
        received_at: msg.receivedAt.toISOString(),
    }, { onConflict: "account_id,tg_message_id", ignoreDuplicates: true });
}
export async function openInbox(accountId) {
    // Já aberta? só renova o heartbeat
    const existing = sessions.get(accountId);
    if (existing) {
        existing.lastHeartbeat = Date.now();
        return { ok: true };
    }
    const { data: account } = await supabase
        .from("mtproto_accounts")
        .select("session_string, status")
        .eq("id", accountId)
        .single();
    if (!account?.session_string || account.status !== "active") {
        return { ok: false, error: "account not active" };
    }
    const client = new MtprotoClient(config.telegramApiId, config.telegramApiHash, account.session_string);
    try {
        await client.connect();
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    // 1) Hidrata histórico
    try {
        const history = await client.getTelegramOfficialHistory(50);
        for (const m of history) {
            await persistMessage(accountId, m);
        }
    }
    catch (err) {
        console.error(`[inbox] history fetch failed for ${accountId}:`, err);
    }
    // 2) Liga listener pra novas
    client.startInboxListener(async (msg) => {
        try {
            await persistMessage(accountId, msg);
        }
        catch (err) {
            console.error(`[inbox] persist failed for ${accountId}:`, err);
        }
    });
    // 3) Timer de TTL: se sem heartbeat por TTL_MS, fecha
    const timer = setInterval(async () => {
        const s = sessions.get(accountId);
        if (!s)
            return;
        if (Date.now() - s.lastHeartbeat > TTL_MS) {
            console.log(`[inbox] TTL expired for ${accountId}, closing`);
            await closeInbox(accountId);
        }
    }, 30_000);
    sessions.set(accountId, {
        client,
        lastHeartbeat: Date.now(),
        timer,
    });
    return { ok: true };
}
export async function heartbeatInbox(accountId) {
    const s = sessions.get(accountId);
    if (!s)
        return false;
    s.lastHeartbeat = Date.now();
    return true;
}
export async function closeInbox(accountId) {
    const s = sessions.get(accountId);
    if (!s)
        return;
    clearInterval(s.timer);
    try {
        s.client.stopInboxListener();
        await s.client.disconnect();
    }
    catch (err) {
        console.error(`[inbox] cleanup error for ${accountId}:`, err);
    }
    sessions.delete(accountId);
}
