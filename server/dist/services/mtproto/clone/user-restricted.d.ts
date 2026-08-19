/**
 * Detecta o erro USER_RESTRICTED do Telegram — a conta está limitada pelo
 * anti-spam e não pode criar canais/grupos (channels.CreateChannel volta 403).
 *
 * Espelha o padrão do extractWaitSeconds (../flood.js): detecta por classe/
 * conteúdo do erro, sem depender de formato específico. O RPCError do gramjs
 * traz `errorMessage: "USER_RESTRICTED"` e embute a string em `.message`
 * ("403: USER_RESTRICTED (caused by ...)"), então qualquer um dos dois serve.
 *
 * Usado pelo clone-handler pra marcar mtproto_accounts.create_restricted e tirar
 * a conta do seletor de "criar destino em".
 *
 * Só USER_RESTRICTED — é o erro real/confirmado (visto nos logs de produção). Se
 * outra variante de restrição aparecer nos logs, some aqui E na regra
 * correspondente de lib/mtproto/clone-errors.ts (manter as duas em sincronia).
 */
export declare function isUserRestricted(err: unknown): boolean;
