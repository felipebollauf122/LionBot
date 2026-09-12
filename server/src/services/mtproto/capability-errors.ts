import { extractWaitSeconds } from "./flood.js";

export type PermissionRefusal = "CHAT_ADMIN_REQUIRED" | "CHAT_WRITE_FORBIDDEN";

const CAPABILITY_ERRORS = new Set([
  "CHAT_ADMIN_REQUIRED", "CHAT_WRITE_FORBIDDEN", "CHAT_GUEST_SEND_FORBIDDEN",
  "CHAT_SEND_PLAIN_FORBIDDEN", "CHAT_SEND_MEDIA_FORBIDDEN",
  "CHAT_SEND_STICKERS_FORBIDDEN", "CHAT_SEND_GIFS_FORBIDDEN",
  "CHAT_SEND_PHOTOS_FORBIDDEN", "CHAT_SEND_VIDEOS_FORBIDDEN",
  "CHAT_SEND_AUDIOS_FORBIDDEN", "CHAT_SEND_VOICES_FORBIDDEN",
  "CHAT_SEND_DOCS_FORBIDDEN", "CHAT_SEND_POLL_FORBIDDEN", "CHAT_SEND_WEBPAGE_FORBIDDEN",
  "CHANNEL_PRIVATE", "CHAT_FORBIDDEN", "USER_BANNED_IN_CHANNEL",
  "CHAT_RESTRICTED", "CHAT_FORWARDS_RESTRICTED", "TOPIC_CLOSED", "TOPIC_DELETED",
]);

/** Ausência de uma rota suportada é diferente de falha ao consultar a API. */
export class CapabilityUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "CapabilityUnavailable";
  }
}

export function rpcCode(error: unknown): string {
  if (error instanceof CapabilityUnavailable) return error.reason;
  const e = error as { errorMessage?: unknown; message?: unknown; code?: unknown } | null;
  if (typeof e?.errorMessage === "string") return e.errorMessage;
  if (typeof e?.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(e.code)) return e.code;
  const message = typeof error === "string" ? error : e?.message;
  return typeof message === "string"
    ? message.match(/\b(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH)\b/)?.[0] ?? "UNKNOWN_ERROR"
    : "UNKNOWN_ERROR";
}

export function permissionRefusal(error: unknown): PermissionRefusal | null {
  const code = rpcCode(error);
  // VERIFY: CHAT_WRITE_FORBIDDEN não identifica exclusivamente uma restrição
  // individual. Os dois códigos descrevem a operação recusada; a causa exata
  // exige consultar novamente os direitos da conta e os direitos padrão.
  // https://core.telegram.org/method/messages.sendMessage
  return code === "CHAT_ADMIN_REQUIRED" || code === "CHAT_WRITE_FORBIDDEN" ? code : null;
}

export function isCapabilityError(error: unknown): boolean {
  return error instanceof CapabilityUnavailable || CAPABILITY_ERRORS.has(rpcCode(error));
}

export function describeFailure(error: unknown) {
  const code = rpcCode(error);
  const wait = extractWaitSeconds(error);
  const numericCode = (error as { code?: unknown } | null)?.code;
  const network = /TIMEOUT|TIMED_OUT|ECONN|ENET|EHOST|EAI_AGAIN|NETWORK/.test(code);
  return {
    code,
    retryable: wait !== null || network || (typeof numericCode === "number" && numericCode >= 500),
    retryAfterMs: wait === null ? undefined : Math.max(1, wait) * 1000,
    // Não inclui texto da campanha, access_hash ou sessão nos logs.
  };
}
