/**
 * Detecta CHAT_SEND_PLAIN_FORBIDDEN — o Telegram recusando mensagem de TEXTO
 * puro naquele destino. Vem do direito `send_plain` em ChatBannedRights: o
 * grupo/canal está com "Enviar mensagens" desligado nas permissões padrão, ou
 * a conta está silenciada ali. É permissão DO CHAT, não da conta: trocar de
 * conta não resolve, e tentar de novo no próximo ciclo só queima request.
 *
 * Espelha o padrão do isUserRestricted (./clone/user-restricted.js): o gramjs
 * não tem classe dedicada pra esse código (é um ForbiddenError genérico), então
 * a detecção é por conteúdo — `errorMessage: "CHAT_SEND_PLAIN_FORBIDDEN"` e
 * `.message` "403: CHAT_SEND_PLAIN_FORBIDDEN (caused by messages.SendMessage)".
 *
 * ESCOPO FECHADO DE PROPÓSITO: só este código. Quem chama usa o resultado pra
 * APAGAR o alvo sem contar como falha, então qualquer erro a mais aqui vira
 * alvo sumindo em silêncio. Primo próximo — CHAT_WRITE_FORBIDDEN — fica de
 * fora: aquele é "não posso postar nada aqui", diagnóstico diferente, e
 * continua aparecendo como falha normal na UI.
 */
export function isPlainTextForbidden(err: unknown): boolean {
  if (typeof err === "string") return /CHAT_SEND_PLAIN_FORBIDDEN/i.test(err);
  if (err && typeof err === "object") {
    const e = err as { message?: string; errorMessage?: string };
    const text = `${e.message ?? ""} ${e.errorMessage ?? ""}`;
    return /CHAT_SEND_PLAIN_FORBIDDEN/i.test(text);
  }
  return false;
}
