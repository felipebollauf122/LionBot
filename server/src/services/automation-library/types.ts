import type { MessageEntity } from "@grammyjs/types";

export interface Button { text: string; url: string }
export interface LibraryRules {
  ai_enabled: boolean;
  ai_instructions: string;
  delivery_mode: "review" | "immediate" | "interval";
  interval_seconds: number;
  silent: boolean;
  media_mode: "album" | "separate";
  button_message: string;
  preserve_buttons: boolean;
  buttons: Button[];
  replacements: { from: string; to: string }[];
  prefix: string;
  suffix: string;
  allowed_kinds: string[];
  start_at: string | null;
  timezone: string;
}
export interface ArchivedMedia { kind: string; url: string; file_name: string }
export interface Original {
  kind: string;
  content_text: string;
  media: ArchivedMedia[];
  entities: MessageEntity[];
  inline_links: Button[];
  poll: { question: string; options: string[]; isAnonymous: boolean; allowsMultipleAnswers: boolean } | null;
  file_name: string | null;
  /** Additional source metadata is archival data, never used as instructions. */
  raw?: unknown;
}
export interface Processed extends Original {
  buttons: Button[];
  delaySeconds: number;
  scheduledAt?: string;
  media_mode: "album" | "separate";
  button_message: string;
  discard: boolean;
  member_ids: string[];
}
export interface Library {
  id: string; tenant_id: string; name: string; dest_dialog_id: string;
  rules: unknown; enabled: boolean; next_send_at: string | null;
}
export interface Source {
  id: string; tenant_id: string; library_id: string; source_dialog_id: string;
  import_history: boolean; watch: boolean;
  status: "pending" | "importing" | "watching" | "paused" | "failed" | "completed";
  cursor_message_id: number; imported_count: number; lease_until: string | null;
  history_until_message_id: number | null; watch_cursor_message_id: number | null;
  watch_lease_until: string | null; watch_lane?: boolean;
}
export interface Item {
  id: string; tenant_id: string; library_id: string; source_id: string;
  source_message_id: number; source_grouped_id: string | null;
  original: Original; processed: Processed | null;
  status: "pending" | "processing" | "ready" | "skipped" | "failed";
  delivery_status: "draft" | "pending" | "sending" | "sent" | "failed";
  scheduled_at: string | null; processing_started_at: string | null;
  delivery_claimed_at: string | null; attempts: number; created_at: string;
  delivery_receipts: Array<{step: string; messageIds: number[]}>;
}
export interface Dialog {
  id: string; tenant_id: string; account_id: string;
  peer_id: string; peer_type: "channel" | "chat" | "user";
  peer_access_hash: string | null;
}
export interface ArchivedUnit {
  messages: { id: number; groupedId: string | null; original: Original }[];
  cursor: number;
}
