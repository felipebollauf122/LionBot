/**
 * O que as permissões vistas na SINCRONIZAÇÃO já dizem sobre poder escrever
 * num dialog. Vira mtproto_dialogs.write_block (null = pode); os rebuilds de
 * campanha global deixam de fora quem tem bloqueio, e o alvo entra como
 * 'skipped' com o motivo em vez de virar falha no envio.
 *
 * Funções puras sobre um recorte estrutural de Api.Channel / Api.Chat, pra
 * serem testáveis sem instanciar classe do gramjs. Os códigos devolvidos
 * reaproveitam o vocabulário do MTProto quando existe (a UI traduz os dois
 * lados com a mesma tabela — lib/mtproto/campaign-errors.ts); LEFT_CHAT e
 * CHAT_DEACTIVATED são nossos porque o Telegram não tem código de envio
 * pra "você nem está mais lá".
 */

interface BannedRightsLike {
  sendMessages?: boolean;
  sendPlain?: boolean;
}

interface AdminRightsLike {
  postMessages?: boolean;
}

export interface ChannelWriteFlags {
  broadcast?: boolean;
  megagroup?: boolean;
  creator?: boolean;
  left?: boolean;
  restricted?: boolean;
  forum?: boolean;
  adminRights?: AdminRightsLike | null;
  /** Restrições impostas À CONTA neste chat (silenciada). */
  bannedRights?: BannedRightsLike | null;
  /** Permissões padrão do chat pra membros comuns. */
  defaultBannedRights?: BannedRightsLike | null;
}

export interface ChatWriteFlags {
  creator?: boolean;
  left?: boolean;
  deactivated?: boolean;
  adminRights?: AdminRightsLike | null;
  defaultBannedRights?: BannedRightsLike | null;
}

export type WriteBlock =
  | "CHAT_ADMIN_REQUIRED"
  | "CHAT_WRITE_FORBIDDEN"
  | "CHAT_SEND_PLAIN_FORBIDDEN"
  | "CHAT_RESTRICTED"
  | "LEFT_CHAT"
  | "CHAT_DEACTIVATED";

function blockFromRights(rights: BannedRightsLike | null | undefined): WriteBlock | null {
  if (!rights) return null;
  if (rights.sendMessages) return "CHAT_WRITE_FORBIDDEN";
  if (rights.sendPlain) return "CHAT_SEND_PLAIN_FORBIDDEN";
  return null;
}

/** Canal broadcast ou supergrupo (Api.Channel). */
export function channelWriteBlock(c: ChannelWriteFlags): WriteBlock | null {
  if (c.left) return "LEFT_CHAT";
  if (c.restricted) return "CHAT_RESTRICTED";
  if (c.broadcast) {
    // Em canal broadcast nem o dono escapa da regra: precisa do direito.
    const canPost = Boolean(c.creator || c.adminRights?.postMessages);
    return canPost ? null : "CHAT_ADMIN_REQUIRED";
  }
  // Supergrupo: restrição individual vale sempre, mesmo que fosse admin.
  const own = blockFromRights(c.bannedRights);
  if (own) return own;
  // Qualquer admin (dono ou com qualquer direito) ignora as permissões padrão.
  if (c.creator || c.adminRights) return null;
  return blockFromRights(c.defaultBannedRights);
}

/** Grupo legado (Api.Chat). */
export function chatWriteBlock(c: ChatWriteFlags): WriteBlock | null {
  if (c.deactivated) return "CHAT_DEACTIVATED";
  if (c.left) return "LEFT_CHAT";
  if (c.creator || c.adminRights) return null;
  return blockFromRights(c.defaultBannedRights);
}
