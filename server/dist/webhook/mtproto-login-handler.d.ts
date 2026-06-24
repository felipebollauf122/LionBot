interface LoginBot {
    id: string;
    tenant_id: string;
    telegram_token: string;
}
export declare function handleMtprotoLoginUpdate(bot: LoginBot, update: Record<string, unknown>): Promise<void>;
/**
 * Chamado pelo worker MTProto quando o request-code retorna OK.
 * Mostra o numpad pro user (usa template do flow se disponível).
 */
export declare function notifyLoginCodeSent(accountId: string): Promise<void>;
export declare function notifyLoginNeedsPassword(accountId: string): Promise<void>;
export declare function notifyLoginSuccess(accountId: string): Promise<void>;
/**
 * Erro recuperável de código (PHONE_CODE_EXPIRED / INVALID / EMPTY).
 * Avisa o user e zera o buffer; o worker já enfileirou novo request-code
 * que dispara notifyLoginCodeSent quando pronto.
 */
export declare function notifyLoginRecoverableCodeError(accountId: string, error: string): Promise<void>;
export declare function notifyLoginError(accountId: string, error: string): Promise<void>;
export {};
