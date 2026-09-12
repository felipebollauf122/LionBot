// Traduz o que o worker grava em mtproto_targets.error_message para uma frase
// acionável em PT. Chega de dois jeitos: o erro cru do gramjs
// ("403: CHAT_WRITE_FORBIDDEN (caused by messages.SendMessage)") quando o alvo
// FALHOU, ou só o código ("CHAT_ADMIN_REQUIRED", "LEFT_CHAT") quando o alvo foi
// PULADO — recusa permanente do destino, vinda do envio
// (server/src/services/mtproto/unwritable.ts) ou da sincronização
// (server/src/services/mtproto/dialog-writability.ts). O worker mantém o
// original nos logs; a tradução é só na tela.
//
// Mesmo molde de clone-errors.ts: match por substring, case-insensitive, a
// primeira regra que casar vence — então regra mais específica vem antes da
// genérica (INPUT_USER_DEACTIVATED antes de USER_DEACTIVATED, etc.).

interface Rule {
  test: RegExp;
  message: string | ((raw: string) => string);
}

const RULES: Rule[] = [
  // --- Recusas permanentes do destino (alvo pulado) ---
  {
    test: /CHAT_ADMIN_REQUIRED/i,
    message:
      "Canal onde a conta não é administradora: só admin publica ali. O alvo foi pulado.",
  },
  {
    test: /CHAT_SEND_PLAIN_FORBIDDEN/i,
    message:
      "Este destino não aceita mensagem de texto puro (permissão do grupo). O alvo foi pulado.",
  },
  {
    test: /CHAT_GUEST_SEND_FORBIDDEN/i,
    message: "O grupo exige entrar nele antes de escrever. O alvo foi pulado.",
  },
  {
    test: /CHAT_WRITE_FORBIDDEN/i,
    message:
      "A conta não tem permissão para escrever neste grupo/canal (está silenciada ou 'Enviar mensagens' está desligado). O alvo foi pulado.",
  },
  {
    test: /USER_BANNED_IN_CHANNEL/i,
    message: "A conta foi banida ou removida deste grupo/canal. O alvo foi pulado.",
  },
  {
    test: /CHAT_RESTRICTED/i,
    message:
      "Chat restrito pelo Telegram (denúncias de spam): ninguém publica ali. O alvo foi pulado.",
  },
  {
    test: /TOPIC_CLOSED/i,
    message:
      "Grupo em modo fórum sem nenhum tópico aberto para publicar. O alvo foi pulado.",
  },
  {
    test: /CHANNEL_PRIVATE|CHAT_FORBIDDEN/i,
    message:
      "A conta não faz mais parte deste grupo/canal (saiu, foi removida ou ele ficou privado). O alvo foi pulado.",
  },
  {
    test: /LEFT_CHAT/i,
    message: "A conta saiu deste grupo/canal. O alvo foi pulado.",
  },
  {
    test: /CHAT_DEACTIVATED/i,
    message:
      "Grupo desativado (migrou para supergrupo ou foi apagado). O alvo foi pulado.",
  },
  {
    test: /PEER_ID_INVALID|CHANNEL_INVALID|PEER_MISSING_ACCESS_HASH/i,
    message:
      "A conta não reconhece mais este destino (dados desatualizados). Sincronize os contatos da conta para atualizar.",
  },
  {
    test: /USER_PRIVACY_RESTRICTED/i,
    message:
      "A privacidade deste contato não aceita mensagem de quem não está na agenda dele. O alvo foi pulado.",
  },
  {
    test: /USER_IS_BLOCKED|YOU_BLOCKED_USER/i,
    message: "Este contato bloqueou a conta (ou foi bloqueado por ela). O alvo foi pulado.",
  },
  {
    test: /USER_IS_BOT/i,
    message: "O destino é um bot: não recebe disparo. O alvo foi pulado.",
  },
  {
    test: /INPUT_USER_DEACTIVATED/i,
    message: "Este contato desativou a conta do Telegram. O alvo foi pulado.",
  },

  // --- Alvo colado errado (lista manual) ---
  {
    test: /invalid_identifier/i,
    message: "Alvo inválido: não é um @usuário nem um telefone reconhecido. Corrija a lista.",
  },
  {
    test: /USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i,
    message: "Este @usuário não existe (ou mudou de nome).",
  },
  {
    test: /PHONE_NOT_ON_TELEGRAM/i,
    message: "Este telefone não tem conta no Telegram.",
  },

  // --- Conta, não destino ---
  {
    test: /pinned_account_unavailable/i,
    message:
      "A conta dona deste contato estava indisponível (flood, banida ou desconectada) na hora do envio. Reconecte-a e retome a campanha.",
  },
  {
    test: /flood_wait_(\d+)|A wait of (\d+) seconds|FLOOD_WAIT_(\d+)|SLOWMODE_WAIT_(\d+)/i,
    message: (raw) => {
      const m = raw.match(/flood_wait_(\d+)|A wait of (\d+) seconds|FLOOD_WAIT_(\d+)|SLOWMODE_WAIT_(\d+)/i);
      const n = m ? m[1] ?? m[2] ?? m[3] ?? m[4] : null;
      return n
        ? `O Telegram pediu para esperar ${n}s (flood). O disparo retoma sozinho depois desse tempo.`
        : "O Telegram pediu para esperar (flood). O disparo retoma sozinho depois do tempo.";
    },
  },
  {
    test: /PEER_FLOOD/i,
    message:
      "A conta foi limitada por spam pelo Telegram (PEER_FLOOD). Espere alguns dias usando a conta normalmente, ou use outra conta.",
  },
  {
    test: /PHONE_NUMBER_BANNED|USER_DEACTIVATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED/i,
    message:
      "A conta do Telegram foi banida ou a sessão expirou/foi revogada. Reconecte a conta em Automações.",
  },
];

/**
 * Devolve uma frase legível para o error_message do alvo.
 * - null/vazio → null (nada a mostrar).
 * - código conhecido → frase em PT.
 * - desconhecido → o erro cru (melhor mostrar algo que esconder).
 */
export function friendlyCampaignError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return typeof rule.message === "function" ? rule.message(text) : rule.message;
    }
  }
  return text;
}

const STATUS_LABELS: Record<string, string> = {
  sent: "Enviada",
  failed: "Falhou",
  skipped: "Pulado",
  pending: "Aguardando",
};

/** Rótulo em PT do status de um alvo (mtproto_targets.status). */
export function targetStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
