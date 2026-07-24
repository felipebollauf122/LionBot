// Traduz o erro cru do Telegram/gramjs guardado em clone_jobs.last_error para
// uma mensagem acionável em PT. O worker sempre grava o erro cru (os logs
// mantêm o original pra debug); a tradução é só na UI, pro operador/cliente
// entender o que fazer sem decorar código de erro do MTProto.
//
// Match por substring, case-insensitive: o erro do gramjs vem como
// "403: USER_RESTRICTED (caused by channels.CreateChannel)", então basta o
// código aparecer em qualquer lugar da string.

interface Rule {
  test: RegExp;
  message: string | ((raw: string) => string);
}

const RULES: Rule[] = [
  {
    // Conta flagada pelo anti-spam: não cria canal, não fala com estranho.
    // É o caso mais comum em conta nova / número VoIP / conta denunciada.
    test: /USER_RESTRICTED/i,
    message:
      "A conta escolhida para criar o destino está limitada pelo anti-spam do Telegram (não cria canais). Ela já foi marcada como restrita e sumiu do seletor — escolha outra conta para criar o destino, ou resolva no @SpamBot e libere a conta no card dela.",
  },
  {
    // Limite de spam ao interagir com peers — parente do USER_RESTRICTED.
    test: /PEER_FLOOD/i,
    message:
      "A conta foi limitada por spam pelo Telegram (PEER_FLOOD). Espere alguns dias usando a conta normalmente, ou use outra conta.",
  },
  {
    // Sessão morta: banimento de número, conta desativada ou sessão revogada.
    test: /PHONE_NUMBER_BANNED|USER_DEACTIVATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED/i,
    message:
      "A conta do Telegram foi banida ou a sessão expirou/foi revogada. Reconecte a conta em Automações antes de clonar.",
  },
  {
    // Conta já em canais/grupos demais (limite ~500-1000 do Telegram).
    test: /CHANNELS_TOO_MUCH/i,
    message:
      "Essa conta já participa de canais/grupos demais (limite do Telegram). Saia de alguns ou use outra conta.",
  },
  {
    // Bot com Group Privacy ligado no BotFather não pode ser promovido.
    test: /BOT_GROUPS_BLOCKED/i,
    message:
      "O bot está com 'Group Privacy' ligado no @BotFather. Desligue (e ligue 'allow groups') nas configurações do bot e tente de novo.",
  },
  {
    // Bot não virou admin do destino, ou não pode postar.
    test: /CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|RIGHT_FORBIDDEN/i,
    message:
      "O bot não tem permissão para postar no destino (não é admin ou perdeu o direito). Confira se o bot ainda é administrador do canal.",
  },
  {
    // Flood: o runner retoma sozinho depois do tempo; se surgir aqui, informa.
    test: /A wait of (\d+) seconds|FLOOD_WAIT|SLOWMODE_WAIT/i,
    message: (raw) => {
      const secs = raw.match(/A wait of (\d+) seconds|FLOOD_WAIT_(\d+)|SLOWMODE_WAIT_(\d+)/i);
      const n = secs ? secs[1] ?? secs[2] ?? secs[3] : null;
      return n
        ? `O Telegram pediu para esperar ${n}s (flood). O clone retoma sozinho depois desse tempo — não precisa fazer nada.`
        : "O Telegram pediu para esperar (flood). O clone retoma sozinho depois do tempo.";
    },
  },
  {
    // Origem com "proteger conteúdo" bloqueando até o download (raro; o clone
    // já degrada pra rota download, mas se o Telegram travar tudo, avisa).
    test: /CHAT_FORWARDS_RESTRICTED/i,
    message:
      "A origem bloqueou o encaminhamento do conteúdo. O clone tenta baixar e reenviar; se isso persistir, a origem restringiu salvar/copiar completamente.",
  },
];

/**
 * Devolve uma mensagem legível para o erro guardado em last_error.
 * - null/vazio → null (nada a mostrar).
 * - erro conhecido → mensagem em PT.
 * - erro já legível em PT (ex.: nossas próprias mensagens) → devolve como está.
 * - desconhecido → o erro cru (melhor mostrar algo que esconder).
 */
export function friendlyCloneError(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      return typeof rule.message === "function" ? rule.message(raw) : rule.message;
    }
  }
  return raw;
}
