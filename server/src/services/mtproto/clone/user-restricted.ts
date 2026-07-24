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
 */
export function isUserRestricted(err: unknown): boolean {
  if (typeof err === "string") return /USER_RESTRICTED/i.test(err);
  if (err && typeof err === "object") {
    const e = err as { message?: string; errorMessage?: string };
    const text = `${e.message ?? ""} ${e.errorMessage ?? ""}`;
    return /USER_RESTRICTED/i.test(text);
  }
  return false;
}
