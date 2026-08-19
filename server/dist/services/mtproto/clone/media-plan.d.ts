export type CloneMediaKind = "photo" | "video" | "document" | "audio" | "sticker" | "animation";
export type MediaPlan = {
    kind: "text";
} | {
    kind: "media";
    mediaKind: CloneMediaKind;
} | {
    kind: "poll";
} | {
    kind: "skip";
    reason: string;
};
export interface PlanInput {
    /** className da Api.Message.media, ou null quando não há mídia. */
    mediaClassName: string | null;
    /** classNames dos atributos do documento, quando a mídia é documento. */
    documentAttributeClassNames: string[];
    hasText: boolean;
    copyPolls: boolean;
}
export declare function planForMessage(input: PlanInput): MediaPlan;
