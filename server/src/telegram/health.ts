/** Shared by the HTTP wrapper and grammy. Never classify per-chat 403s as deletion. */
export function isBotCredentialFailure(code: number, description = ""): boolean {
  return code === 401 || (code === 403 && /\bbot (?:was |is )?(?:deleted|deactivated|banned)\b/i.test(description));
}

export class TelegramApiError extends Error {
  constructor(readonly method: string, readonly error_code: number, description: string) {
    super(`Telegram API error (${method}): ${description}`);
  }
}

type FailureObserver = (token: string) => Promise<void>;
let observer: FailureObserver | undefined;
export function observeBotCredentialFailures(handler?: FailureObserver): void {
  observer = handler;
}

export async function reportBotCredentialFailure(token: string, code: number, description?: string): Promise<void> {
  if (!observer || !isBotCredentialFailure(code, description)) return;
  // Monitoring failure must not mask the original API error or leak credentials.
  try { await observer(token); } catch { console.error("[bot-healing] Failed to schedule credential check"); }
}
