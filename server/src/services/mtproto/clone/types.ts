/** Peer da origem, reconstruído a partir de mtproto_dialogs. */
export interface ClonePeer {
  peerId: string;
  peerType: "channel" | "chat";
  accessHash: string | null;
}

/** Rota de cópia resolvida em runtime. */
export type CloneStrategy = "batch" | "download";

export type CloneStatus =
  | "draft"
  | "running"
  | "paused"
  | "waiting_flood"
  | "completed"
  | "failed";

/**
 * Mensagem da origem normalizada. `raw` carrega o Api.Message do gramjs, mas
 * fica opaco para o runner — só o message-cloner destrincha.
 */
export interface SourceMessage {
  id: number;
  groupedId: string | null;
  replyToMsgId: number | null;
  raw: unknown;
}

export type CloneOutcome =
  | { status: "copied"; destMsgId: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export interface CloneMapRow {
  sourceMsgId: number;
  destMsgId: number | null;
  groupedId: string | null;
  status: "copied" | "skipped" | "failed";
  reason: string | null;
}

export interface CloneJobConfig {
  jobId: string;
  messageLimit: number | null;
  throttleMs: number;
  copyReplies: boolean;
  copyPins: boolean;
  copyButtons: boolean;
  copyPolls: boolean;
}
