/** Peer da origem, reconstruído a partir de mtproto_dialogs. */
export interface ClonePeer {
    peerId: string;
    peerType: "channel" | "chat";
    accessHash: string | null;
}
/** Rota de cópia resolvida em runtime. */
export type CloneStrategy = "batch" | "download";
export type CloneStatus = "draft" | "running" | "paused" | "waiting_flood" | "completed" | "failed";
/**
 * Mensagem da origem normalizada. `raw` carrega o Api.Message do gramjs, mas
 * fica opaco para o runner — só o message-cloner destrincha.
 */
export interface SourceMessage {
    id: number;
    groupedId: string | null;
    replyToMsgId: number | null;
    /** Id do tópico de fórum dono da mensagem (raiz do tópico). null = General ou canal sem fórum. */
    topicId: number | null;
    raw: unknown;
}
/** Tópico de fórum da origem, normalizado — DTO puro, sem tipos do gramjs. */
export interface SourceTopic {
    id: number;
    title: string;
    iconColor: number;
    iconEmojiId: string | null;
    closed: boolean;
    pinned: boolean;
}
export interface CloneTopicMapRow {
    sourceTopicId: number;
    destTopicId: number | null;
    title: string;
    status: "copied" | "skipped" | "failed";
    reason: string | null;
}
export type CloneOutcome = {
    status: "copied";
    destMsgId: number;
} | {
    status: "skipped";
    reason: string;
} | {
    status: "failed";
    reason: string;
};
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
