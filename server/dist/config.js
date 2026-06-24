import { strict as assert } from "node:assert";
function env(key) {
    const value = process.env[key];
    assert(value, `Missing environment variable: ${key}`);
    return value;
}
function envOptional(key, fallback) {
    return process.env[key] ?? fallback;
}
export const config = {
    port: parseInt(envOptional("PORT", "3001"), 10),
    supabaseUrl: env("SUPABASE_URL"),
    supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    redisUrl: envOptional("REDIS_URL", "redis://localhost:6379"),
    baseWebhookUrl: env("BASE_WEBHOOK_URL"), // e.g. https://your-domain.com
    telegramApiId: parseInt(envOptional("TELEGRAM_API_ID", "0"), 10),
    telegramApiHash: envOptional("TELEGRAM_API_HASH", ""),
    mtprotoWorkerEnabled: envOptional("MTPROTO_WORKER_ENABLED", "true") === "true",
    // EvPay: se 'true', rejeita webhook com HMAC inválido. Se 'false' (padrão),
    // só loga warning e processa mesmo assim. Mantido tolerante por padrão até
    // confirmar que a assinatura tá calibrada com o que o Yvepay envia.
    evpayRequireSignature: envOptional("EVPAY_REQUIRE_SIGNATURE", "false") === "true",
    // Web Push (VAPID) — push de venda nos dispositivos do tenant.
    // Se as chaves não estiverem setadas, o push é silenciosamente desativado.
    vapidPublicKey: envOptional("VAPID_PUBLIC_KEY", ""),
    vapidPrivateKey: envOptional("VAPID_PRIVATE_KEY", ""),
    vapidSubject: envOptional("VAPID_SUBJECT", "mailto:admin@lionbot.app"),
};
