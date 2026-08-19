import { Queue } from "bullmq";
export type MtprotoJobData = {
    kind: "auth.request-code";
    accountId: string;
    phoneNumber: string;
} | {
    kind: "auth.sign-in";
    accountId: string;
    phoneNumber: string;
    code: string;
} | {
    kind: "auth.submit-password";
    accountId: string;
    password: string;
} | {
    kind: "campaign.run";
    campaignId: string;
} | {
    kind: "account.sync-dialogs";
    accountId: string;
} | {
    kind: "clone.run";
    cloneJobId: string;
} | {
    kind: "botclone.explore";
    cloneJobId: string;
} | {
    kind: "botclone.build-flow";
    cloneJobId: string;
};
export declare const mtprotoQueue: Queue<MtprotoJobData, any, string, MtprotoJobData, any, string>;
export declare function enqueueMtproto(data: MtprotoJobData, opts?: {
    delayMs?: number;
}): Promise<void>;
