import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * Verifica se um telegram_user_id está na blacklist do bot.
 * Blacklisted users não devem receber NENHUM fluxo (nem visual, nem black,
 * nem remarketing, nem mensagens pós-pagamento). O bot trata como se eles
 * não existissem — silêncio total. Útil pra excluir reviewers/moderadores
 * do Telegram que poderiam derrubar o bot ao ver o conteúdo.
 *
 * Performance (#31): carrega a blacklist inteira do bot UMA vez e cacheia
 * como Set por 5 min. Antes era 1 query por mensagem. Cache miss = 1 query
 * que traz todos os ids do bot. Mudança na blacklist reflete em até 5 min
 * (ou imediato se invalidateBlacklist for chamado ao editar).
 */
export declare function isBlacklisted(db: SupabaseClient, botId: string, telegramUserId: number): Promise<boolean>;
/** Invalida o cache de blacklist de um bot (chamar ao adicionar/remover). */
export declare function invalidateBlacklist(botId: string): void;
