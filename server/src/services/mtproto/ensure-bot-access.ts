/**
 * Garante que o bot companheiro é admin do canal de destino de uma campanha.
 *
 * Quem promove é a conta MTProto dona do dialog — o Next não fala MTProto, e
 * o bot não consegue se auto-promover. Roda antes de publicar pra o dono não
 * descobrir o problema só quando a primeira postagem falha.
 */

export interface EnsureBotAccessDeps {
  promote(channelId: string, accessHash: string, botUsername: string): Promise<void>;
}

export type BotAccessResult = { ok: true } | { ok: false; error: string };

/** O bot já estava lá com os direitos certos: repromover não muda nada. */
const JA_ADMIN = /NOT_MODIFIED/i;

/**
 * Erros com causa conhecida e ação clara pro dono. Qualquer outro sobe com a
 * mensagem original — inventar texto amigável pra erro desconhecido esconde a
 * causa de quem poderia consertar.
 */
const CONHECIDOS: Array<{ padrao: RegExp; mensagem: string }> = [
  {
    padrao: /BOT_GROUPS_BLOCKED/i,
    mensagem:
      "O bot está com a privacidade de grupo ligada. Abra o BotFather, vá em Bot Settings › Group Privacy e desligue, depois tente de novo.",
  },
  {
    padrao: /RIGHT_FORBIDDEN|CHAT_ADMIN_REQUIRED/i,
    mensagem:
      "A conta conectada não tem permissão para promover administradores neste canal. Use uma conta que seja administradora com direito de adicionar admins.",
  },
  {
    padrao: /CHANNEL_INVALID|CHANNEL_PRIVATE/i,
    mensagem:
      "A conta conectada não enxerga mais este canal. Sincronize os diálogos da conta e escolha o destino de novo.",
  },
  {
    padrao: /USER_ADMIN_INVALID/i,
    mensagem:
      "O Telegram recusou a promoção do bot neste canal. Adicione o bot como administrador manualmente e tente publicar de novo.",
  },
];

export async function ensureBotAccess(
  deps: EnsureBotAccessDeps,
  input: { channelId: string; accessHash: string; botUsername: string },
): Promise<BotAccessResult> {
  try {
    await deps.promote(input.channelId, input.accessHash, input.botUsername);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (JA_ADMIN.test(msg)) return { ok: true };
    for (const c of CONHECIDOS) {
      if (c.padrao.test(msg)) return { ok: false, error: c.mensagem };
    }
    return { ok: false, error: `Não deu pra promover o bot: ${msg}` };
  }
}
