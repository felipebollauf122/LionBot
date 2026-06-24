import type { SupabaseClient } from "@supabase/supabase-js";
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
export declare function pollChannelMonitors(db: SupabaseClient): Promise<void>;
