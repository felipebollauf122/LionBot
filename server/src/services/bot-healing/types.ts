export interface Identity {
  name: string;
  username: string;
  telegramId: number;
  description: string;
  about: string;
  photoPath: string | null;
}

export interface RecoveryRun {
  id: string;
  bot_id: string;
  tenant_id: string;
  token_hash: string;
  status: "queued" | "creating" | "restoring" | "completed" | "needs_attention" | "cancelled";
  account_id: string | null;
  attempts: string[];
  pending_username: string | null;
  pending_after_id: number | null;
  new_token: string | null;
  new_username: string | null;
  retry_at: string | null;
  error_code: string | null;
}

export class RecoveryAttention extends Error {
  constructor(readonly code: string) { super(code); }
}
export class RetryRecovery extends Error {
  constructor(readonly seconds: number, readonly notSent = false) { super("retry_later"); }
}
export class AccountBotLimit extends Error {}

export interface BotFatherPort {
  exchange(text: string, beforeSend?: (afterId: number) => Promise<void>): Promise<string>;
  repliesSince(afterId: number): Promise<string[]>;
  photo(bytes: Buffer): Promise<string>;
}

export type SaveRun = (patch: Partial<RecoveryRun>) => Promise<void>;
