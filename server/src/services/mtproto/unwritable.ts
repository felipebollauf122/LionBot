/**
 * Recusas PERMANENTES do destino: códigos com que o Telegram diz "esta conta
 * nunca vai conseguir postar aqui" — não é flood, não é a conta, não é
 * transitório. Trocar de conta dá a mesma recusa e retentar no próximo ciclo
 * só queima request (e poluía a tela do operador com código cru do MTProto).
 *
 * Quem chama PULA o alvo (status='skipped', fora do total) e marca o dialog
 * (mtproto_dialogs.send_refusal) pra ele não voltar no próximo rebuild da
 * campanha global. Por isso a lista é fechada e explícita: cada código a mais
 * aqui é um alvo que some da campanha sem virar falha visível. Erro de
 * identificador colado errado (USERNAME_*), flood, PEER_FLOOD e sessão morta
 * NÃO entram — esses continuam no caminho de falha/flood/fatal do runner.
 *
 * Detecção por conteúdo, como isUserRestricted (./clone/user-restricted.js):
 * o RPCError do gramjs traz `errorMessage: "CHAT_WRITE_FORBIDDEN"` e embute o
 * código em `.message` ("403: CHAT_WRITE_FORBIDDEN (caused by ...)").
 */
const UNWRITABLE_CODES = [
  // Canal broadcast: só admin com post_messages publica.
  "CHAT_ADMIN_REQUIRED",
  // Conta silenciada ali, ou "Enviar mensagens" desligado nas permissões padrão.
  "CHAT_WRITE_FORBIDDEN",
  // Permissões padrão recusam texto puro (só mídia/sticker etc.).
  "CHAT_SEND_PLAIN_FORBIDDEN",
  // Grupo exige entrar antes de escrever.
  "CHAT_GUEST_SEND_FORBIDDEN",
  // Conta banida/removida do grupo ou canal.
  "USER_BANNED_IN_CHANNEL",
  // Chat restrito pelo próprio Telegram (denúncias) — ninguém posta.
  "CHAT_RESTRICTED",
  // Conta não faz mais parte, ou o chat virou privado/foi apagado.
  "CHANNEL_PRIVATE",
  "CHAT_FORBIDDEN",
  // Peer que esta conta não reconhece (access_hash de outra conta/estale).
  "CHANNEL_INVALID",
  "PEER_ID_INVALID",
  // Fórum sem tópico aberto (o worker já tentou achar um antes de chegar aqui).
  "TOPIC_CLOSED",
  // Contato que não recebe desta conta.
  "USER_IS_BLOCKED",
  "YOU_BLOCKED_USER",
  "USER_PRIVACY_RESTRICTED",
  "INPUT_USER_DEACTIVATED",
  // Bot não recebe disparo.
  "USER_IS_BOT",
] as const;

export type UnwritableReason = (typeof UNWRITABLE_CODES)[number];

// (?<![A-Z_]) / (?![A-Z_]): o código tem que aparecer inteiro. Sem isso,
// USER_DEACTIVATED (sessão morta — fatal da CONTA) casaria dentro de
// INPUT_USER_DEACTIVATED, e CHAT_FORBIDDEN dentro de CHAT_WRITE_FORBIDDEN.
const PATTERN = new RegExp(`(?<![A-Z_])(${UNWRITABLE_CODES.join("|")})(?![A-Z_])`);

/**
 * Devolve o código da recusa permanente, ou null se o erro não for uma.
 */
export function classifyUnwritable(err: unknown): UnwritableReason | null {
  let text: string;
  if (typeof err === "string") {
    text = err;
  } else if (err && typeof err === "object") {
    const e = err as { message?: unknown; errorMessage?: unknown };
    text = `${typeof e.message === "string" ? e.message : ""} ${
      typeof e.errorMessage === "string" ? e.errorMessage : ""
    }`;
  } else {
    return null;
  }
  const m = PATTERN.exec(text);
  return m ? (m[1] as UnwritableReason) : null;
}
